// 音蔵: エントリポイント（MVP 取込〜一覧〜簡易再生）
const v = new URL(import.meta.url).searchParams.get('v') || '0';

async function boot() {
  const [{ renderShell }, { storage }, { db }, metricsMod] = await Promise.all([
    import(`./ui.js?v=${v}`),
    import(`./storage.js?v=${v}`),
    import(`./db.js?v=${v}`),
    import(`./metrics.js?v=${v}`),
  ]);

  await db.init();
  const root = document.getElementById('app');
  renderShell(root);

  const fileInput = root.querySelector('#fileInput');
  const searchInput = root.querySelector('#search');
  const listEl = root.querySelector('#trackList');
  const playerEl = root.querySelector('#player');

  let audio = null;
  let currentId = null;
  let fired90 = false;
  let currentUrl = null;
  const settings = await db.getSettings();
  let playbackRate = Number(settings.playbackRate || 1.0) || 1.0;

  function ensurePlayerUI() {
    if (!audio) {
      playerEl.innerHTML = `
        <div class="toolbar" aria-label="プレイヤー操作">
          <button class="btn" data-ctl="back15">-15秒</button>
          <button class="btn" data-ctl="playPause">再生/一時停止</button>
          <button class="btn" data-ctl="fwd15">+15秒</button>
          <label class="sr-only" for="rateSel">速度</label>
          <select id="rateSel" class="input" style="min-width:96px">
            <option value="0.75">0.75×</option>
            <option value="1" selected>1.0×</option>
            <option value="1.25">1.25×</option>
            <option value="1.5">1.5×</option>
            <option value="2">2.0×</option>
          </select>
        </div>
      `;
      audio = document.createElement('audio');
      audio.controls = true;
      playerEl.appendChild(audio);

      const rateSel = playerEl.querySelector('#rateSel');
      rateSel.value = String(playbackRate);
      audio.playbackRate = playbackRate;

      playerEl.addEventListener('click', (e)=>{
        const btn = e.target.closest('button[data-ctl]');
        if (!btn) return;
        const act = btn.dataset.ctl;
        if (act === 'back15') audio.currentTime = Math.max(0, (audio.currentTime||0) - 15);
        if (act === 'fwd15') audio.currentTime = Math.min((audio.duration||0), (audio.currentTime||0) + 15);
        if (act === 'playPause') {
          if (audio.paused) audio.play().catch(()=>{}); else audio.pause();
        }
      });

      rateSel.addEventListener('change', async ()=>{
        playbackRate = Number(rateSel.value) || 1.0;
        audio.playbackRate = playbackRate;
        await db.setSettings({ playbackRate });
      });

      window.addEventListener('beforeunload', async ()=>{
        if (!currentId) return;
        const lastPositionMs = Math.floor((audio.currentTime || 0) * 1000);
        const stats = await db.getPlayStats(currentId);
        await db.setPlayStats(currentId, { ...stats, lastPositionMs });
      });
    }
  }

  async function renderList(filter = '') {
    const tracks = await db.listTracks();
    const q = filter.trim().toLowerCase();
    const filtered = tracks.filter(t => !q || (t.displayName || '').toLowerCase().includes(q));
    const statsArr = await Promise.all(filtered.map(t => db.getPlayStats(t.id)));
    const items = filtered.map((t, i) => ({
      id: t.id,
      name: t.displayName || t.path,
      path: t.path,
      size: t.size,
      addedAt: t.addedAt,
      playCount: statsArr[i]?.playCount || 0,
      lastPlayedAt: statsArr[i]?.lastPlayedAt || 0,
    }));
    listEl.innerHTML = items.map(item => `
      <li class="item" data-id="${item.id}">
        <div>
          <div>${item.name}</div>
          <div class="meta">${(item.size||0)} bytes • 追加:${new Date(item.addedAt||Date.now()).toLocaleString()} • 再生:${item.playCount}${item.lastPlayedAt?` • 最終:${new Date(item.lastPlayedAt).toLocaleString()}`:''}</div>
        </div>
        <div>
          <button class="btn" data-action="play">再生</button>
        </div>
      </li>
    `).join('');
  }

  async function playTrackById(id) {
    const tracks = await db.listTracks();
    const t = tracks.find(x => x.id === id);
    if (!t) return;
    const blob = await storage.getFile(t.path);
    if (!blob) return;

    ensurePlayerUI();
    fired90 = false;
    currentId = id;
    if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
    currentUrl = URL.createObjectURL(blob);
    audio.src = currentUrl;
    audio.playbackRate = playbackRate;

    const stats = await db.getPlayStats(id);
    const resumeMs = stats?.lastPositionMs || 0;

    audio.onloadedmetadata = async () => {
      if (resumeMs > 0 && audio.duration && isFinite(audio.duration)) {
        audio.currentTime = Math.min(audio.duration - 0.2, resumeMs / 1000);
      }
      const durationMs = Math.floor((audio.duration || 0) * 1000);
      if (durationMs && (!t.durationMs || Math.abs(t.durationMs - durationMs) > 500)) {
        await db.updateTrack(t.id, { durationMs });
      }
    };

    audio.ontimeupdate = async () => {
      const durationMs = Math.floor((audio.duration || 0) * 1000);
      const currentMs = Math.floor((audio.currentTime || 0) * 1000);
      if (!fired90 && metricsMod.reachedNinetyPercent(currentMs, durationMs)) {
        fired90 = true;
        const st = await db.getPlayStats(id);
        await db.setPlayStats(id, { ...st, playCount: (st.playCount||0)+1, lastPlayedAt: Date.now() });
        renderList(searchInput.value);
      }
    };

    audio.onpause = async () => {
      if (!currentId) return;
      const lastPositionMs = Math.floor((audio.currentTime || 0) * 1000);
      const st = await db.getPlayStats(currentId);
      await db.setPlayStats(currentId, { ...st, lastPositionMs });
    };

    audio.onended = async () => {
      const st = await db.getPlayStats(id);
      await db.setPlayStats(id, { ...st, lastPositionMs: 0, lastPlayedAt: Date.now() });
      renderList(searchInput.value);
    };

    await audio.play().catch(()=>{});
  }

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const li = btn.closest('li[data-id]');
    if (!li) return;
    const id = li.getAttribute('data-id');
    if (btn.dataset.action === 'play') {
      playTrackById(id);
    }
  });

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    for (const f of files) {
      if (!f || !/wav$/i.test(f.type) && !/\.wav$/i.test(f.name)) continue;
      const key = await storage.saveFile(f.name, f);
      const track = {
        id: (self.crypto?.randomUUID?.() || (`t_${Date.now()}_${Math.random().toString(36).slice(2)}`)),
        path: key,
        displayName: f.name.replace(/\.[Ww][Aa][Vv]$/, ''),
        durationMs: 0,
        size: f.size,
        addedAt: Date.now(),
        updatedAt: Date.now(),
      };
      await db.addTrack(track);
    }
    fileInput.value = '';
    renderList(searchInput.value);
  });

  searchInput.addEventListener('input', () => renderList(searchInput.value));

  await renderList();
}

document.addEventListener('DOMContentLoaded', boot);
