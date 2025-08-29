// 音蔵: エントリポイント（MVP 取込〜一覧〜簡易再生）
const v = new URL(import.meta.url).searchParams.get('v') || '0';

async function boot() {
  const [{ renderShell }, { storage }, { db }] = await Promise.all([
    import(`./ui.js?v=${v}`),
    import(`./storage.js?v=${v}`),
    import(`./db.js?v=${v}`),
  ]);

  await db.init();
  const root = document.getElementById('app');
  renderShell(root);

  const fileInput = root.querySelector('#fileInput');
  const searchInput = root.querySelector('#search');
  const listEl = root.querySelector('#trackList');
  const playerEl = root.querySelector('#player');

  async function renderList(filter = '') {
    const tracks = await db.listTracks();
    const q = filter.trim().toLowerCase();
    const items = tracks
      .filter(t => !q || (t.displayName || '').toLowerCase().includes(q))
      .map(t => ({ id: t.id, name: t.displayName || t.path, path: t.path, size: t.size, addedAt: t.addedAt }));
    listEl.innerHTML = items.map(item => `
      <li class="item" data-id="${item.id}">
        <div>
          <div>${item.name}</div>
          <div class="meta">${(item.size||0)} bytes • ${new Date(item.addedAt||Date.now()).toLocaleString()}</div>
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
    let audio = playerEl.querySelector('audio');
    if (!audio) {
      audio = document.createElement('audio');
      audio.controls = true;
      playerEl.innerHTML = '';
      playerEl.appendChild(audio);
    }
    const url = URL.createObjectURL(blob);
    audio.src = url;
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
