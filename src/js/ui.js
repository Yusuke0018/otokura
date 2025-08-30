// UI: DOM構築（最小雛形）
export function renderShell(root){
  if(!root) return;
  root.innerHTML = `
    <h1 class="title">音蔵（おとくら）</h1>
    <div class="layout">
      <aside class="sidebar" id="sidebar" aria-label="フォルダ">
        <div class="head">
          <div style="font-weight:600">フォルダ</div>
          <button id="newFolder" class="btn">新規</button>
        </div>
        <ul id="folderList" class="folders" aria-label="フォルダ一覧"></ul>
      </aside>
      <section class="content">
        <div class="toolbar" role="toolbar" aria-label="ライブラリ操作">
          <input id="fileInput" class="sr-only" type="file" accept=".wav,audio/wav,audio/x-wav,audio/wave,audio/vnd.wave" multiple>
          <button id="importBtn" class="btn primary">取り込み</button>
          <button id="rescanBtn" class="btn" title="ストレージから再スキャン">再スキャン</button>
          <label class="sr-only" for="sortKey">並び替え</label>
          <select id="sortKey" class="input">
            <option value="addedAt">追加日時</option>
            <option value="displayName">名前</option>
            <option value="playCount">再生回数</option>
            <option value="popular">よく聞く</option>
          </select>
          <button id="sortDir" class="btn" aria-pressed="false" title="昇順/降順">降順</button>
          <input id="search" class="input" type="search" placeholder="検索">
        </div>
        <ul id="trackList" class="list cards" aria-label="トラック一覧"></ul>
        <div id="player" class="player" aria-label="プレイヤー領域"></div>
        <section id="queuePanel" class="queue-panel" aria-label="再生キュー" hidden>
          <header class="queue-head">
            <div class="q-title">再生キュー</div>
            <div class="q-actions">
              <button id="queueShuffle" class="btn toggle" aria-pressed="false" title="シャッフル">シャッフル</button>
              <button id="queueRepeat" class="btn toggle" aria-pressed="false" title="リピート（1曲）">リピート</button>
              <button id="queueClear" class="btn" title="キューを空にする">クリア</button>
            </div>
          </header>
          <ul id="queueList" class="list q-list" aria-label="キュー一覧"></ul>
        </section>
      </section>
    </div>
    <div id="toast" class="toast" aria-live="polite" aria-atomic="true"></div>
    <div id="modal-root" class="modal-root" aria-live="polite" aria-atomic="true"></div>
  `;
  const importBtn = root.querySelector('#importBtn');
  const fileInput = root.querySelector('#fileInput');
  importBtn?.addEventListener('click', ()=> fileInput?.click());
}

export function toast(msg, opts={}){
  const box = document.getElementById('toast');
  if (!box) return;
  const div = document.createElement('div');
  div.className = `msg${opts.type?` ${opts.type}`:''}`;
  div.textContent = String(msg||'');
  box.appendChild(div);
  setTimeout(()=>{ div.classList.add('hide'); div.style.opacity='0'; setTimeout(()=>div.remove(), 300); }, opts.ms||2500);
}
export const showError = (m)=> toast(m, { type: 'error', ms: 4000 });

export function promptModal({ title='入力', label='名前', value='' }={}){
  return new Promise((resolve)=>{
    const root = document.getElementById('modal-root');
    if (!root) return resolve(null);
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div role="dialog" aria-modal="true" class="modal">
        <header>${title}</header>
        <div class="content">
          <div class="field">
            <label>${label}</label>
            <input id="promptInput" type="text" value="${value}" />
          </div>
          <div id="promptError" class="meta" aria-live="polite"></div>
        </div>
        <footer>
          <button class="btn" data-act="cancel">キャンセル</button>
          <button class="btn primary" data-act="ok">OK</button>
        </footer>
      </div>
    `;
    root.appendChild(wrap);
    const input = wrap.querySelector('#promptInput');
    const err = wrap.querySelector('#promptError');
    const close = (val)=>{ wrap.remove(); resolve(val); };
    const validate = () => {
      const v = String(input.value||'');
      if (!v.trim()) { err.textContent = '名称を入力してください。'; return false; }
      if (/[\\/:*?"<>|\u0000-\u001F]/.test(v)) { err.textContent = '使用できない文字が含まれています。'; return false; }
      if (v.length > 128) { err.textContent = '名称が長すぎます（128文字以内）。'; return false; }
      err.textContent = '';
      return true;
    };
    wrap.addEventListener('click', (e)=>{
      const actBtn = e.target.closest('button[data-act]');
      if (!actBtn) return;
      const act = actBtn.dataset.act;
      if (act === 'cancel') close(null);
      if (act === 'ok') { if (validate()) close(String(input.value||'').trim()); }
    });
    input.addEventListener('input', validate);
    input.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') { e.preventDefault(); if (validate()) close(String(input.value||'').trim()); } });
    setTimeout(()=> input.focus(), 0);
  });
}

export function folderPickerModal(folders){
  return new Promise((resolve)=>{
    const root = document.getElementById('modal-root');
    if (!root) return resolve(null);
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    const opts = [`<option value="">(なし)</option>`].concat(
      folders.map(f=>`<option value="${f.id}">${f.name}</option>`)
    ).join('');
    wrap.innerHTML = `
      <div role="dialog" aria-modal="true" class="modal">
        <header>フォルダに移動</header>
        <div class="content">
          <div class="field">
            <label>フォルダ</label>
            <select id="folderSel" class="input">${opts}</select>
          </div>
        </div>
        <footer>
          <button class="btn" data-act="cancel">キャンセル</button>
          <button class="btn primary" data-act="ok">OK</button>
        </footer>
      </div>`;
    root.appendChild(wrap);
    const sel = wrap.querySelector('#folderSel');
    const close = (val)=>{ wrap.remove(); resolve(val); };
    wrap.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'cancel') close(null);
      if (btn.dataset.act === 'ok') close(sel.value || null);
    });
    setTimeout(()=> sel.focus(), 0);
  });
}
