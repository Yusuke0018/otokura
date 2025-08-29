// UI: DOM構築（最小雛形）
export function renderShell(root){
  if(!root) return;
  root.innerHTML = `
    <h1>音蔵（おとくら）</h1>
    <div class="toolbar" role="toolbar" aria-label="ライブラリ操作">
      <input id="fileInput" class="sr-only" type="file" accept=".wav,audio/wav,audio/x-wav,audio/wave,audio/vnd.wave" multiple>
      <button id="importBtn" class="btn primary">取り込み</button>
      <label class="sr-only" for="sortKey">並び替え</label>
      <select id="sortKey" class="input">
        <option value="addedAt">追加日時</option>
        <option value="displayName">名前</option>
        <option value="playCount">再生回数</option>
      </select>
      <button id="sortDir" class="btn" aria-pressed="false" title="昇順/降順">降順</button>
      <input id="search" class="input" type="search" placeholder="検索">
    </div>
    <ul id="trackList" class="list" aria-label="トラック一覧"></ul>
    <div id="player" class="player" aria-label="プレイヤー領域"></div>
    <div id="toast" class="toast" aria-live="polite" aria-atomic="true"></div>
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
