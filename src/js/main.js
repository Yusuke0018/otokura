// 音蔵: エントリポイント（MVP 取込〜一覧〜簡易再生）
const v = new URL(import.meta.url).searchParams.get('v') || '0';

async function boot() {
  const [{ renderShell, toast, showError, promptModal, folderPickerModal }, { storage }, { db }, metricsMod] = await Promise.all([
    import(`./ui.js?v=${v}`),
    import(`./storage.js?v=${v}`),
    import(`./db.js?v=${v}`),
    import(`./metrics.js?v=${v}`),
  ]);

  await db.init();
  const root = document.getElementById('app');
  renderShell(root);
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register(`./sw.js?v=${v}`); } catch {}
  }

  const fileInput = root.querySelector('#fileInput');
  const searchInput = root.querySelector('#search');
  const listEl = root.querySelector('#trackList');
  const playerEl = root.querySelector('#player');
  const folderListEl = root.querySelector('#folderList');
  const newFolderBtn = root.querySelector('#newFolder');
  const sortKeySel = root.querySelector('#sortKey');
  const sortDirBtn = root.querySelector('#sortDir');

  let audio = null;
  let currentId = null;
  let fired90 = false;
  let currentUrl = null;
  const settings = await db.getSettings();
  let playbackRate = Number(settings.playbackRate || 1.0) || 1.0;
  let sortKey = settings.sortKey || 'addedAt';
  let sortDir = settings.sortDir || 'desc';
  let currentFolderId = null;
  if (sortKeySel) sortKeySel.value = sortKey;
  if (sortDirBtn) sortDirBtn.textContent = (sortDir==='desc'?'降順':'昇順');

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
    const filtered = tracks.filter(t => {
      const inFolder = currentFolderId ? (t.folderId === currentFolderId) : true;
      const match = !q || (t.displayName || '').toLowerCase().includes(q);
      return inFolder && match;
    });
    const statsArr = await Promise.all(filtered.map(t => db.getPlayStats(t.id)));
    const items = filtered.map((t, i) => ({
      id: t.id,
      name: t.displayName || t.path,
      path: t.path,
      size: t.size,
      addedAt: t.addedAt,
      playCount: statsArr[i]?.playCount || 0,
      lastPlayedAt: statsArr[i]?.lastPlayedAt || 0,
      durationMs: t.durationMs || 0,
    }));
    const dirMul = (sortDir==='desc') ? -1 : 1;
    if (sortKey === 'popular') {
      items.sort((a,b)=>{
        if ((b.playCount|0) !== (a.playCount|0)) return (b.playCount|0) - (a.playCount|0);
        return (b.lastPlayedAt|0) - (a.lastPlayedAt|0);
      });
      if (sortDir === 'asc') items.reverse();
    } else {
      items.sort((a,b)=>{
        const k = sortKey;
        let va = a[k] ?? '';
        let vb = b[k] ?? '';
        if (k === 'displayName' || k === 'name') { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
        if (va < vb) return -1 * dirMul;
        if (va > vb) return 1 * dirMul;
        return 0;
      });
    }
    const fmtTime = (ms)=>{
      const s = Math.max(0, Math.round(ms/1000));
      const m = Math.floor(s/60), ss = String(s%60).padStart(2,'0');
      return m+':'+ss;
    };
    const fmtSize = (bytes)=>{
      if (!bytes && bytes!==0) return '';
      const mb = bytes/1024/1024; return (mb>=1? mb.toFixed(1)+'MB' : (bytes/1024).toFixed(0)+'KB');
    };
    listEl.innerHTML = items.map(item => `
      <li class="card" data-id="${item.id}">
        <div class="card-body" data-action="play-quick">
          <div class="card-title">${item.name}</div>
          <div class="card-sub">
            ${item.durationMs?`<span class="chip">${fmtTime(item.durationMs)}</span>`:''}
            ${item.size?`<span class="chip">${fmtSize(item.size)}</span>`:''}
            <span class="chip">再生 ${item.playCount||0}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn icon kebab" data-menu="toggle" aria-haspopup="menu" aria-expanded="false" aria-label="メニュー">⋯</button>
          <div class="menu" role="menu">
            <button class="menu-item" data-action="play">再生</button>
            <button class="menu-item" data-action="move">移動</button>
            <button class="menu-item" data-action="rename">名称変更</button>
            <button class="menu-item" data-action="info">情報</button>
            <button class="menu-item danger" data-action="delete">削除</button>
          </div>
        </div>
      </li>
    `).join('');
  }

  async function playTrackById(id) {
    const tracks = await db.listTracks();
    const t = tracks.find(x => x.id === id);
    if (!t) return;
    const blob = await storage.getFile(t.path);
    if (!blob) { showError('ファイルを読み出せませんでした。'); return; }

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

    audio.onerror = () => {
      showError('再生に失敗しました。対応していない形式か破損の可能性があります。');
    };
    await audio.play().catch(()=>{});
    if (!window.__otokuraKeysBound) {
      window.__otokuraKeysBound = true;
      document.addEventListener('keydown', (e)=>{
        if (!audio) return;
        const el = e.target;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable)) return;
        if (e.code === 'Space') { e.preventDefault(); if (audio.paused) audio.play().catch(()=>{}); else audio.pause(); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); audio.currentTime = Math.max(0, (audio.currentTime||0) - 5); }
        if (e.key === 'ArrowRight') { e.preventDefault(); audio.currentTime = Math.min((audio.duration||0), (audio.currentTime||0) + 5); }
        if (e.key === '[') { e.preventDefault(); playbackRate = Math.max(0.5, Math.round((playbackRate-0.25)*100)/100); audio.playbackRate = playbackRate; db.setSettings({ playbackRate }); }
        if (e.key === ']') { e.preventDefault(); playbackRate = Math.min(3.0, Math.round((playbackRate+0.25)*100)/100); audio.playbackRate = playbackRate; db.setSettings({ playbackRate }); }
      });
    }
  }

  listEl.addEventListener('click', (e) => {
    const body = e.target.closest('.card-body');
    if (body && listEl.contains(body)){
      const li = body.closest('li[data-id]');
      if (li) { const id = li.getAttribute('data-id'); playTrackById(id); return; }
    }
    const kebab = e.target.closest('[data-menu="toggle"]');
    if (kebab){
      const actions = kebab.parentElement;
      const menu = actions.querySelector('.menu');
      const open = menu.classList.toggle('open');
      kebab.setAttribute('aria-expanded', open? 'true':'false');
      e.stopPropagation();
      return;
    }
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const li = btn.closest('li[data-id]');
    if (!li) return;
    const id = li.getAttribute('data-id');
    if (btn.dataset.action === 'play') {
      playTrackById(id);
    } else if (btn.dataset.action === 'info') {
      handleInfo(id);
    } else if (btn.dataset.action === 'move') {
      handleMove(id);
    } else if (btn.dataset.action === 'rename') {
      handleRename(id);
    } else if (btn.dataset.action === 'delete') {
      handleDelete(id);
    }
  });
  document.addEventListener('click', (e)=>{
    for (const m of listEl.querySelectorAll('.menu.open')) m.classList.remove('open');
    for (const k of listEl.querySelectorAll('[data-menu="toggle"][aria-expanded="true"]')) k.setAttribute('aria-expanded','false');
  });

  async function renderFolders(){
    const folders = await db.listFolders();
    const items = [{ id: null, name: 'すべて' }, ...folders];
    folderListEl.innerHTML = items.map(f => `
      <li class="folder${(f.id===currentFolderId)?' active':''}" data-id="${f.id||''}">
        <span class="name">${f.name}</span>
        ${f.id ? `<span class="actions">
          <button class="btn" data-act="rename" title="名称変更">✎</button>
          <button class="btn" data-act="delete" title="削除">🗑</button>
        </span>` : ''}
      </li>
    `).join('');
  }

  folderListEl.addEventListener('click', async (e)=>{
    const li = e.target.closest('li.folder');
    if (!li) return;
    const id = li.getAttribute('data-id') || null;
    const actBtn = e.target.closest('button[data-act]');
    if (actBtn && id){
      if (actBtn.dataset.act === 'rename'){
        const name = li.querySelector('.name')?.textContent || '';
        const input = await promptModal({ title: 'フォルダ名称変更', label: '新しい名前', value: name });
        if (input == null) return;
        await db.updateFolder(id, { name: String(input).trim() });
        await renderFolders();
        return;
      } else if (actBtn.dataset.act === 'delete'){
        if (!confirm('フォルダを削除します。フォルダ内のトラックは「すべて」に残ります。')) return;
        await db.removeFolder(id);
        if (currentFolderId === id) currentFolderId = null;
        await renderFolders();
        await renderList(searchInput.value);
        return;
      }
    }
    // select folder
    currentFolderId = id || null;
    await renderFolders();
    await renderList(searchInput.value);
  });

  newFolderBtn.addEventListener('click', async ()=>{
    const input = await promptModal({ title: '新規フォルダ', label: 'フォルダ名', value: '' });
    if (input == null) return;
    const folder = { id: (self.crypto?.randomUUID?.() || (`f_${Date.now()}_${Math.random().toString(36).slice(2)}`)), name: String(input).trim(), createdAt: Date.now(), updatedAt: Date.now() };
    await db.addFolder(folder);
    await renderFolders();
  });

  async function handleMove(id){
    const folders = await db.listFolders();
    const chosen = await folderPickerModal(folders);
    if (chosen === undefined) return;
    const tracks = await db.listTracks();
    const t = tracks.find(x=>x.id===id);
    if (!t) return;
    await db.updateTrack(id, { folderId: chosen || null });
    await renderList(searchInput.value);
  }

  async function handleInfo(id){
    const tracks = await db.listTracks();
    const t = tracks.find(x=>x.id===id);
    if (!t) return;
    const st = await db.getPlayStats(id);
    const details = [
      `名前: ${t.displayName || t.path}`,
      `保存名: ${t.path}`,
      `サイズ: ${t.size||0} bytes` ,
      `長さ: ${t.durationMs?`${(t.durationMs/1000).toFixed(1)}s`:'(未取得)'}`,
      `追加: ${new Date(t.addedAt||Date.now()).toLocaleString()}`,
      `更新: ${new Date(t.updatedAt||t.addedAt||Date.now()).toLocaleString()}`,
      `再生回数: ${st.playCount||0}`,
      `最終再生: ${st.lastPlayedAt?new Date(st.lastPlayedAt).toLocaleString():'(なし)'}`,
      `最終位置: ${st.lastPositionMs?`${(st.lastPositionMs/1000).toFixed(1)}s`:'0s'}`,
    ].join('\n');
    alert(details);
  }

  function sanitizeTitle(name){
    return String(name||'').replace(/[\\/:*?"<>|\u0000-\u001F]/g,'_').trim().slice(0,128);
  }

  async function handleRename(id){
    const tracks = await db.listTracks();
    const t = tracks.find(x=>x.id===id);
    if (!t) return;
    const current = t.displayName || t.path || '';
    const input = await promptModal({ title: '名称変更', label: '新しい名前（拡張子不要）', value: current });
    if (input == null) return;
    const base = sanitizeTitle(input);
    if (!base) { showError('名称が無効です。'); return; }
    const newFileName = `${base}.wav`;
    let newPath = t.path;
    if (await storage.exists(newFileName)) { showError('同名のファイルが既に存在します。'); return; }
    try {
      newPath = await storage.renameExact(t.path, newFileName) || t.path;
    } catch { showError('名称変更に失敗しました。'); return; }
    await db.updateTrack(t.id, { displayName: base, path: newPath });
    if (currentId === id && audio) {
      // 再生中はそのまま、次回再生で新パスを使用
    }
    renderList(searchInput.value);
    toast('名称を変更しました。');
  }

  async function handleDelete(id) {
    const tracks = await db.listTracks();
    const t = tracks.find(x => x.id === id);
    if (!t) return;
    const ok = confirm(`「${t.displayName||t.path}」を削除します。よろしいですか？`);
    if (!ok) return;
    try {
      await storage.remove(t.path);
    } catch { showError('実体ファイルの削除に失敗しました。'); }
    await db.removeTrack(id);
    await db.removePlayStats(id);
    if (currentId === id && audio) {
      try { audio.pause(); } catch {}
      if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
      currentId = null;
      playerEl.innerHTML = '';
      audio = null;
    }
    renderList(searchInput.value);
    toast('削除しました。');
  }

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    const MAX_BYTES = 200 * 1024 * 1024; // 200MB
    let warned = false;

    const isWavType = (t) => /^audio\/(wav|x-wav|wave|vnd\.wave)$/i.test(String(t||''));
    const isWavName = (n) => /\.wav$/i.test(String(n||''));
    const sniffWav = async (file) => {
      try {
        const buf = await file.slice(0, 12).arrayBuffer();
        const b = new Uint8Array(buf);
        const ascii = (i,len)=>String.fromCharCode(...b.slice(i,i+len));
        return ascii(0,4)==='RIFF' && ascii(8,4)==='WAVE';
      } catch { return false; }
    };

    let saved = 0;
    for (const f of files) {
      if (!f) continue;
      let ok = isWavType(f.type) || isWavName(f.name);
      if (!ok) ok = await sniffWav(f);
      if (!ok) { toast(`${f.name} はWAVとして認識できませんでした。`); continue; }
      if (f.size > MAX_BYTES) {
        if (!warned) { alert('200MBを超えるファイルは取り込み対象外です。'); warned = true; }
        continue;
      }
      try {
        if (navigator.storage?.estimate) {
          const { quota=0, usage=0 } = await navigator.storage.estimate();
          const remain = Math.max(0, quota - usage);
          if (remain && remain < f.size * 1.05) {
            toast('空き容量が不足している可能性があります。取り込みを試行します…');
          }
        }
      } catch {}
      let key;
      try {
        key = await storage.saveFile(f.name, f);
      } catch (e) {
        showError('取り込みに失敗しました（容量不足またはブラウザ制限）。');
        continue;
      }
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
      saved++;
    }
    fileInput.value = '';
    renderList(searchInput.value);
    if (saved>0) toast(`${saved} 件を取り込みました。`);
  });

  searchInput.addEventListener('input', () => renderList(searchInput.value));

  if (sortKeySel) sortKeySel.addEventListener('change', async ()=>{
    sortKey = sortKeySel.value;
    await db.setSettings({ sortKey });
    renderList(searchInput.value);
  });
  if (sortDirBtn) sortDirBtn.addEventListener('click', async ()=>{
    sortDir = (sortDir==='desc') ? 'asc' : 'desc';
    sortDirBtn.textContent = (sortDir==='desc'?'降順':'昇順');
    await db.setSettings({ sortDir });
    renderList(searchInput.value);
  });

  await renderFolders();
  await renderList();
}

document.addEventListener('DOMContentLoaded', boot);
