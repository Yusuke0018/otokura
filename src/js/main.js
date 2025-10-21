// 音蔵: エントリポイント（MVP 取込〜一覧〜簡易再生）
const v = new URL(import.meta.url).searchParams.get('v') || '0';

async function boot() {
  const [{ renderShell, toast, showError, showSuccess, promptModal, folderPickerModal }, { storage }, { db }, metricsMod] = await Promise.all([
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
  const playFromTopBtn = root.querySelector('#playFromTop');
  const searchInput = root.querySelector('#search');
  const shuffleModeBtn = root.querySelector('#shuffleMode');
  const shufflePlayBtn = root.querySelector('#shufflePlay');
  const listEl = root.querySelector('#trackList');
  const playerEl = root.querySelector('#player');
  const folderListEl = root.querySelector('#folderList');
  const newFolderBtn = root.querySelector('#newFolder');
  const sortKeySel = root.querySelector('#sortKey');
  const reorderToggleBtn = root.querySelector('#reorderToggle');
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
  // 連続再生用の状態
  let shuffle = !!settings.shuffle;
  let repeatAll = !!settings.repeatAll;
  let stopAfter = !!settings.stopAfterCurrent;
  let visibleItems = [];
  let nextUpId = null; // 「次に再生」指定
  let orderMap = settings.manualOrder || {};
  const folderKey = () => (currentFolderId || 'root');
  if (sortKeySel) sortKeySel.value = sortKey;
  if (sortDirBtn) {
    const icon = sortDirBtn.querySelector('#sortDirIcon');
    if (icon) icon.textContent = (sortDir==='desc'?'⬇️':'⬆️');
  }
  const syncReorderToggle = () => { if (reorderToggleBtn) reorderToggleBtn.setAttribute('aria-pressed', (sortKey==='manual')?'true':'false'); };
  syncReorderToggle();
  let reorderPrevSortKey = (sortKey==='manual') ? 'addedAt' : sortKey;
  const syncToolbarShuffle = () => { if (shuffleModeBtn) shuffleModeBtn.setAttribute('aria-pressed', shuffle ? 'true' : 'false'); };
  syncToolbarShuffle();
  const syncPlayerShuffle = () => {
    try {
      const btn = playerEl.querySelector('[data-ctl="shuffle"]');
      if (btn) btn.setAttribute('aria-pressed', shuffle ? 'true' : 'false');
    } catch {}
  };

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
          <button class="btn toggle" data-ctl="shuffle" aria-pressed="false" title="シャッフル（フォルダ内）">シャッフル</button>
          <button class="btn toggle" data-ctl="repeat" aria-pressed="false" title="リピート（フォルダ）">リピート</button>
          <button class="btn toggle" data-ctl="stopAfter" aria-pressed="false" title="この曲で停止">1曲で停止</button>
        </div>
      `;
      audio = document.createElement('audio');
      audio.controls = true;
      playerEl.appendChild(audio);

      const rateSel = playerEl.querySelector('#rateSel');
      rateSel.value = String(playbackRate);
      audio.playbackRate = playbackRate;

      const syncToggleUI = () => {
        const sh = playerEl.querySelector('[data-ctl="shuffle"]');
        const rp = playerEl.querySelector('[data-ctl="repeat"]');
        const sa = playerEl.querySelector('[data-ctl="stopAfter"]');
        if (sh) sh.setAttribute('aria-pressed', shuffle? 'true' : 'false');
        if (rp) rp.setAttribute('aria-pressed', repeatAll? 'true' : 'false');
        if (sa) sa.setAttribute('aria-pressed', stopAfter? 'true' : 'false');
      };
      syncToggleUI();

      playerEl.addEventListener('click', async (e)=>{
        const btn = e.target.closest('button[data-ctl]');
        if (!btn) return;
        const act = btn.dataset.ctl;
        if (act === 'back15') audio.currentTime = Math.max(0, (audio.currentTime||0) - 15);
        if (act === 'fwd15') audio.currentTime = Math.min((audio.duration||0), (audio.currentTime||0) + 15);
        if (act === 'playPause') {
          if (audio.paused) audio.play().catch(()=>{}); else audio.pause();
        }
        if (act === 'shuffle') { shuffle = !shuffle; syncToggleUI(); await db.setSettings({ shuffle }); }
        if (act === 'repeat')  { repeatAll = !repeatAll; syncToggleUI(); await db.setSettings({ repeatAll }); }
        if (act === 'stopAfter') { stopAfter = !stopAfter; syncToggleUI(); await db.setSettings({ stopAfterCurrent: stopAfter }); }
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
    if (sortKey === 'manual' && !q) {
      const ord = orderMap[folderKey()] || [];
      const idx = new Map(ord.map((id,i)=>[id,i]));
      items.sort((a,b)=>{
        const ia = idx.has(a.id) ? idx.get(a.id) : 1e9;
        const ib = idx.has(b.id) ? idx.get(b.id) : 1e9;
        if (ia !== ib) return ia - ib;
        // fallback to addedAt
        if (a.addedAt < b.addedAt) return -1 * dirMul;
        if (a.addedAt > b.addedAt) return 1 * dirMul;
        return 0;
      });
    } else if (sortKey === 'popular') {
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
    visibleItems = items.slice();

    // ドロップゾーンの表示/非表示
    const dropZone = document.getElementById('dropZone');
    if (dropZone) {
      dropZone.style.display = items.length === 0 ? 'block' : 'none';
    }

    listEl.innerHTML = items.map(item => `
      <li class="card${currentId === item.id ? ' playing' : ''}" data-id="${item.id}" draggable="true">
        <div class="card-body" data-action="play-quick">
          <div class="card-title">${item.name}</div>
          <div class="card-sub">
            ${item.durationMs?`<span class="chip">${fmtTime(item.durationMs)}</span>`:''}
            ${item.size?`<span class="chip">${fmtSize(item.size)}</span>`:''}
            <span class="chip">再生 ${item.playCount||0}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn-icon on-mobile" data-action="rename" aria-label="ファイル名変更">✎</button>
          <button class="btn btn-icon on-mobile" data-action="delete" aria-label="削除">🗑</button>
          <button class="btn btn-icon kebab" data-menu="toggle" aria-haspopup="menu" aria-expanded="false" aria-label="メニュー">⋯</button>
          <div class="menu" role="menu">
            <button class="menu-item" data-action="play">再生</button>
            <button class="menu-item" data-action="playNext">次に再生</button>
            <button class="menu-item" data-action="move">移動</button>
            <button class="menu-item" data-action="rename">ファイル名変更</button>
            <button class="menu-item" data-action="info">情報</button>
            <button class="menu-item danger" data-action="delete">削除</button>
          </div>
        </div>
      </li>
    `).join('');
  }

  async function loadTrackById(id, autoplay = false) {
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
      if (stopAfter) return;
      if (nextUpId) { const nid = nextUpId; nextUpId = null; await loadTrackById(nid, true); return; }
      const ids = (visibleItems||[]).map(x => x.id);
      if (!ids.length) return;
      let nextId = null;
      if (shuffle) {
        const candidates = ids.filter(x => x !== id);
        if (candidates.length === 0) return;
        nextId = candidates[Math.floor(Math.random() * candidates.length)];
      } else {
        const idx = ids.indexOf(id);
        if (idx >= 0 && idx + 1 < ids.length) {
          nextId = ids[idx + 1];
        } else if (repeatAll && ids.length > 0) {
          nextId = ids[0];
        }
      }
      if (nextId) await loadTrackById(nextId, true);
    };

    audio.onerror = () => {
      showError('再生に失敗しました。対応していない形式か破損の可能性があります。');
    };
    if (autoplay) {
      await audio.play().catch(()=>{});
    } else {
      try { audio.pause(); } catch {}
    }
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
      if (li) { const id = li.getAttribute('data-id'); loadTrackById(id, false); return; }
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
      loadTrackById(id, true);
    } else if (btn.dataset.action === 'playNext') {
      nextUpId = id;
      toast('次に再生に設定しました');
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
  // Long-press (mobile): manual reorder in "手動" mode; otherwise rename
  let lpTimer = null;
  let touchDrag = { active: false, id: null, targetLi: null, before: true };
  function allowManualReorder(){ return (sortKey === 'manual') && !String(searchInput.value||'').trim(); }
  function clearDropMarkers(){ for (const el of listEl.querySelectorAll('.drop-before,.drop-after')) el.classList.remove('drop-before','drop-after'); }
  function cleanupTouchDrag(){
    touchDrag = { active: false, id: null, targetLi: null, before: true };
    clearDropMarkers();
  }
  listEl.addEventListener('pointerdown', (e) => {
    const body = e.target.closest('.card-body, li.card');
    if (!body || !listEl.contains(body)) return;
    const li = body.closest('li[data-id]');
    if (!li) return;
    const id = li.getAttribute('data-id');
    // Start long-press timer (mobile friendly)
    lpTimer = setTimeout(() => {
      if (e.pointerType === 'touch' && allowManualReorder()) {
        // enter touch-drag reorder mode
        touchDrag = { active: true, id, targetLi: null, before: true };
        li.classList.add('dragging');
      } else {
        handleRename(id);
      }
    }, 650);
  });
  function cancelLongPress(){ if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } }
  listEl.addEventListener('pointermove', (e)=>{
    if (!touchDrag.active) return;
    e.preventDefault();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const target = el && el.closest ? el.closest('li.card[data-id]') : null;
    clearDropMarkers();
    if (!target) { touchDrag.targetLi = null; return; }
    const rect = target.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height/2;
    target.classList.toggle('drop-before', before);
    target.classList.toggle('drop-after', !before);
    touchDrag.targetLi = target;
    touchDrag.before = before;
  });
  function finalizeTouchReorder(){
    if (!touchDrag.active) return;
    const draggedId = touchDrag.id;
    const liDragging = listEl.querySelector(`li.card[data-id="${draggedId}"]`);
    if (liDragging) liDragging.classList.remove('dragging');
    if (!touchDrag.targetLi) { cleanupTouchDrag(); return; }
    const allow = allowManualReorder();
    if (!allow) { cleanupTouchDrag(); return; }
    const targetId = touchDrag.targetLi.getAttribute('data-id');
    const before = touchDrag.before;
    // compute new order based on visibleItems
    const ids = (visibleItems||[]).map(x=>x.id);
    const srcIdx = ids.indexOf(draggedId);
    if (srcIdx >= 0){
      ids.splice(srcIdx,1);
      const destIdxBase = ids.indexOf(targetId);
      let insertAt = destIdxBase + (before? 0 : 1);
      if (insertAt < 0) insertAt = 0; if (insertAt > ids.length) insertAt = ids.length;
      ids.splice(insertAt, 0, draggedId);
      orderMap[folderKey()] = ids.slice();
      db.setSettings({ manualOrder: orderMap });
      renderList(searchInput.value);
    }
    cleanupTouchDrag();
  }
  listEl.addEventListener('pointerup', (e)=>{ cancelLongPress(); if (touchDrag.active) finalizeTouchReorder(); });
  listEl.addEventListener('pointercancel', (e)=>{ cancelLongPress(); cleanupTouchDrag(); });
  listEl.addEventListener('pointerleave', (e)=>{ cancelLongPress(); });
  // Drag & Drop: track -> folder
  listEl.addEventListener('dragstart', (e)=>{
    const li = e.target.closest('li.card[data-id]');
    if (!li) return;
    li.classList.add('dragging');
    e.dataTransfer.setData('text/plain', li.getAttribute('data-id'));
    e.dataTransfer.effectAllowed = 'move';
  });
  listEl.addEventListener('dragend', (e)=>{
    const li = e.target.closest('li.card.dragging');
    if (li) li.classList.remove('dragging');
    // clear any drop markers
    for (const el of listEl.querySelectorAll('.drop-before,.drop-after')) el.classList.remove('drop-before','drop-after');
  });

  // Reorder within list (manual sort)
  listEl.addEventListener('dragover', (e)=>{
    const li = e.target.closest('li.card[data-id]');
    if (!li) return;
    const allow = (sortKey === 'manual') && !String(searchInput.value||'').trim();
    if (!allow) { e.dataTransfer.dropEffect = 'none'; return; }
    e.preventDefault();
    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height/2;
    li.classList.toggle('drop-before', before);
    li.classList.toggle('drop-after', !before);
  });
  listEl.addEventListener('dragleave', (e)=>{
    const li = e.target.closest('li.card[data-id]');
    if (li) li.classList.remove('drop-before','drop-after');
  });
  listEl.addEventListener('drop', async (e)=>{
    const target = e.target.closest('li.card[data-id]');
    if (!target) return;
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId) return;
    const allow = (sortKey === 'manual') && !String(searchInput.value||'').trim();
    if (!allow) { toast('並び替えは「手動」かつ検索なしの時に有効です。'); return; }
    e.preventDefault();
    const targetId = target.getAttribute('data-id');
    const before = target.classList.contains('drop-before');
    // compute new order
    const ids = (visibleItems||[]).map(x=>x.id);
    const srcIdx = ids.indexOf(draggedId);
    if (srcIdx < 0) return;
    ids.splice(srcIdx,1);
    const destIdxBase = ids.indexOf(targetId);
    let insertAt = destIdxBase + (before? 0 : 1);
    if (insertAt < 0) insertAt = 0;
    if (insertAt > ids.length) insertAt = ids.length;
    ids.splice(insertAt, 0, draggedId);
    orderMap[folderKey()] = ids.slice();
    await db.setSettings({ manualOrder: orderMap });
    // clear markers and re-render
    for (const el of listEl.querySelectorAll('.drop-before,.drop-after')) el.classList.remove('drop-before','drop-after');
    await renderList(searchInput.value);
  });

  folderListEl.addEventListener('dragover', (e)=>{
    const li = e.target.closest('li.folder');
    if (!li) return;
    e.preventDefault();
    li.classList.add('drop');
    e.dataTransfer.dropEffect = 'move';
  });
  folderListEl.addEventListener('dragleave', (e)=>{
    const li = e.target.closest('li.folder.drop');
    if (li) li.classList.remove('drop');
  });
  folderListEl.addEventListener('drop', async (e)=>{
    const li = e.target.closest('li.folder');
    if (!li) return;
    e.preventDefault();
    const targetId = li.getAttribute('data-id') || null;
    const trackId = e.dataTransfer.getData('text/plain');
    if (!trackId) return;
    await db.updateTrack(trackId, { folderId: targetId });
    li.classList.remove('drop');
    await renderList(searchInput.value);
    if (currentFolderId !== targetId) { currentFolderId = targetId; await renderFolders(); }
    toast(targetId ? 'フォルダへ移動しました。' : 'フォルダから外しました。');
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
        const input = await promptModal({ title: 'フォルダ名の変更', label: '新しい名前', value: name });
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
    const input = await promptModal({ title: 'ファイル名の変更', label: '新しいファイル名（拡張子不要）', value: current });
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
    toast('ファイル名を変更しました。');
  }

  async function handleDelete(id) {
    const tracks = await db.listTracks();
    const t = tracks.find(x => x.id === id);
    if (!t) return;
    const ok = confirm(`「${t.displayName||t.path}」を削除します。よろしいですか？`);
    if (!ok) return;
    if (currentId === id && audio) {
      try { audio.pause(); } catch {}
      if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
      currentId = null;
      playerEl.innerHTML = '';
      audio = null;
    }
    try {
      await storage.remove(t.path);
    } catch { showError('実体ファイルの削除に失敗しました。'); }
    await db.removeTrack(id);
    await db.removePlayStats(id);
    renderList(searchInput.value);
    toast('削除しました。');
  }

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    // ファイルサイズ制限を削除し、無制限で取り込み可能に
    // const MAX_BYTES = 200 * 1024 * 1024; // 200MB
    // let warned = false;

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
      // ファイルサイズ制限チェックを削除
      // if (f.size > MAX_BYTES) {
      //   if (!warned) { alert('200MBを超えるファイルは取り込み対象外です。'); warned = true; }
      //   continue;
      // }
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
        folderId: currentFolderId || null,
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
    syncReorderToggle();
  });
  if (sortDirBtn) sortDirBtn.addEventListener('click', async ()=>{
    sortDir = (sortDir==='desc') ? 'asc' : 'desc';
    const icon = sortDirBtn.querySelector('#sortDirIcon');
    if (icon) icon.textContent = (sortDir==='desc'?'⬇️':'⬆️');
    await db.setSettings({ sortDir });
    renderList(searchInput.value);
  });

  await renderFolders();
  await renderList();
  // 先頭から再生
  if (playFromTopBtn){
    playFromTopBtn.addEventListener('click', async ()=>{
      if (!visibleItems.length){ toast('再生できる項目がありません'); return; }
      await loadTrackById(visibleItems[0].id, true);
    });
  }
  // シャッフルモード（モバイル向けトグル）
  if (shuffleModeBtn){
    shuffleModeBtn.addEventListener('click', async ()=>{
      shuffle = !shuffle;
      await db.setSettings({ shuffle });
      syncToolbarShuffle();
      syncPlayerShuffle();
      toast(shuffle ? 'シャッフルON' : 'シャッフルOFF');
    });
  }
  // シャッフル再生（表示対象からランダムに開始）
  if (shufflePlayBtn){
    shufflePlayBtn.addEventListener('click', async ()=>{
      if (!visibleItems.length){ toast('再生できる項目がありません'); return; }
      shuffle = true; // 明示的にON
      await db.setSettings({ shuffle });
      syncToolbarShuffle();
      syncPlayerShuffle();
      const ids = visibleItems.map(x=>x.id);
      const pick = ids[Math.floor(Math.random() * ids.length)];
      await loadTrackById(pick, true);
    });
  }
  // 並び替えトグル（モバイル向けボタン）
  if (reorderToggleBtn){
    reorderToggleBtn.addEventListener('click', async ()=>{
      if (sortKey !== 'manual'){
        reorderPrevSortKey = sortKey;
        sortKey = 'manual';
        if (sortKeySel) sortKeySel.value = 'manual';
        await db.setSettings({ sortKey });
        await renderList(searchInput.value);
        syncReorderToggle();
        toast('手動並び替えモードです。長押し→ドラッグで順序変更。検索中は無効です。');
      } else {
        // 直前のキーに戻す
        sortKey = reorderPrevSortKey || 'addedAt';
        if (sortKeySel) sortKeySel.value = sortKey;
        await db.setSettings({ sortKey });
        await renderList(searchInput.value);
        syncReorderToggle();
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', boot);
