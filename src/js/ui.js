// UI: 劇的に改善されたモダンUI
export function renderShell(root){
  if(!root) return;
  root.innerHTML = `
    <div class="app-container">
      <!-- ヘッダー -->
      <header class="app-header">
        <div class="header-content">
          <h1 class="app-title">
            <span class="title-icon">🎵</span>
            <span class="title-text">音蔵</span>
            <span class="title-badge">Premium</span>
          </h1>
          <div class="header-actions">
            <button id="importBtn" class="btn btn-primary btn-import">
              <span class="btn-icon">📁</span>
              <span class="btn-text">ファイル追加</span>
            </button>
          </div>
        </div>
      </header>

      <!-- メインレイアウト -->
      <div class="app-layout">
        <!-- サイドバー -->
        <aside class="app-sidebar" id="sidebar" aria-label="フォルダ">
          <div class="sidebar-section">
            <div class="section-header">
              <h2 class="section-title">
                <span class="section-icon">📂</span>
                フォルダ
              </h2>
              <button id="newFolder" class="btn btn-icon btn-sm" title="新規フォルダ">
                <span>➕</span>
              </button>
            </div>
            <ul id="folderList" class="folder-list" aria-label="フォルダ一覧"></ul>
          </div>

          <!-- キーボードショートカット -->
          <div class="sidebar-section sidebar-help">
            <div class="section-header">
              <h2 class="section-title">
                <span class="section-icon">⌨️</span>
                ショートカット
              </h2>
            </div>
            <div class="shortcuts">
              <div class="shortcut-item">
                <kbd>Space</kbd>
                <span>再生/一時停止</span>
              </div>
              <div class="shortcut-item">
                <kbd>←</kbd><kbd>→</kbd>
                <span>5秒スキップ</span>
              </div>
              <div class="shortcut-item">
                <kbd>↑</kbd><kbd>↓</kbd>
                <span>音量調整</span>
              </div>
              <div class="shortcut-item">
                <kbd>N</kbd>
                <span>次の曲</span>
              </div>
              <div class="shortcut-item">
                <kbd>P</kbd>
                <span>前の曲</span>
              </div>
            </div>
          </div>
        </aside>

        <!-- メインコンテンツ -->
        <main class="app-main">
          <!-- ツールバー -->
          <div class="content-toolbar" role="toolbar" aria-label="ライブラリ操作">
            <div class="search-box">
              <span class="search-icon">🔍</span>
              <input id="search" class="search-input" type="search" placeholder="曲を検索..." autocomplete="off">
            </div>

            <div class="toolbar-controls">
              <div class="sort-controls">
                <label class="sr-only" for="sortKey">並び替え</label>
                <select id="sortKey" class="select-input">
                  <option value="addedAt">📅 追加日時</option>
                  <option value="displayName">🔤 名前</option>
                  <option value="playCount">🔢 再生回数</option>
                  <option value="popular">⭐ よく聞く</option>
                  <option value="manual">✋ 手動</option>
                </select>
                <button id="sortDir" class="btn btn-icon" title="並び順を切り替え">
                  <span id="sortDirIcon">⬇️</span>
                </button>
              </div>

              <div class="play-controls">
                <button id="playFromTop" class="btn btn-icon" title="先頭から再生">
                  <span>⏮️</span>
                </button>
                <button id="shuffleMode" class="btn btn-icon btn-toggle" aria-pressed="false" title="シャッフルモード">
                  <span>🔀</span>
                </button>
                <button id="shufflePlay" class="btn btn-icon" title="シャッフル再生">
                  <span>🎲</span>
                </button>
                <button id="reorderToggle" class="btn btn-icon btn-toggle" aria-pressed="false" title="並び替えモード">
                  <span>↕️</span>
                </button>
              </div>
            </div>
          </div>

          <!-- ドラッグ&ドロップエリア -->
          <div id="dropZone" class="drop-zone">
            <div class="drop-zone-content">
              <div class="drop-zone-icon">📂</div>
              <div class="drop-zone-text">ここにWAVファイルをドロップ</div>
              <div class="drop-zone-hint">または</div>
              <button class="btn btn-primary btn-browse">ファイルを選択</button>
            </div>
          </div>

          <!-- トラックリスト -->
          <ul id="trackList" class="track-list" aria-label="トラック一覧"></ul>
        </main>
      </div>

      <!-- プレイヤー -->
      <div id="player" class="player-container" aria-label="プレイヤー"></div>

      <!-- 非表示の入力 -->
      <input id="fileInput" class="sr-only" type="file" accept=".wav,audio/wav,audio/x-wav,audio/wave,audio/vnd.wave" multiple>
    </div>

    <!-- トースト -->
    <div id="toast" class="toast-container" aria-live="polite" aria-atomic="true"></div>

    <!-- モーダル -->
    <div id="modal-root" class="modal-root" aria-live="polite" aria-atomic="true"></div>
  `;

  // イベントリスナー設定
  const importBtn = root.querySelector('#importBtn');
  const fileInput = root.querySelector('#fileInput');
  const dropZone = root.querySelector('#dropZone');
  const browsBtn = dropZone?.querySelector('.btn-browse');

  importBtn?.addEventListener('click', () => fileInput?.click());
  browsBtn?.addEventListener('click', () => fileInput?.click());

  // ドラッグ&ドロップ処理
  setupDropZone(dropZone, fileInput);
}

function setupDropZone(dropZone, fileInput) {
  if (!dropZone || !fileInput) return;

  const highlight = () => dropZone.classList.add('drop-zone-active');
  const unhighlight = () => dropZone.classList.remove('drop-zone-active');

  ['dragenter', 'dragover'].forEach(event => {
    dropZone.addEventListener(event, (e) => {
      e.preventDefault();
      e.stopPropagation();
      highlight();
    });
  });

  ['dragleave', 'drop'].forEach(event => {
    dropZone.addEventListener(event, (e) => {
      e.preventDefault();
      e.stopPropagation();
      unhighlight();
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      fileInput.files = files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

export function toast(msg, opts = {}) {
  const box = document.getElementById('toast');
  if (!box) return;

  const toast = document.createElement('div');
  toast.className = `toast-message ${opts.type ? 'toast-' + opts.type : ''}`;

  const icon = opts.type === 'error' ? '❌' : opts.type === 'success' ? '✅' : 'ℹ️';
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-text">${String(msg || '')}</span>
  `;

  box.appendChild(toast);

  // アニメーション
  setTimeout(() => toast.classList.add('toast-show'), 10);

  setTimeout(() => {
    toast.classList.remove('toast-show');
    toast.classList.add('toast-hide');
    setTimeout(() => toast.remove(), 300);
  }, opts.ms || 3000);
}

export const showError = (m) => toast(m, { type: 'error', ms: 5000 });
export const showSuccess = (m) => toast(m, { type: 'success', ms: 2000 });

export function promptModal({ title = '入力', label = '名前', value = '' } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    if (!root) return resolve(null);

    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div role="dialog" aria-modal="true" class="modal modal-prompt">
        <div class="modal-header">
          <h3 class="modal-title">${title}</h3>
          <button class="modal-close" data-act="cancel" aria-label="閉じる">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-field">
            <label class="form-label">${label}</label>
            <input id="promptInput" class="form-input" type="text" value="${value}" autocomplete="off" />
          </div>
          <div id="promptError" class="form-error" aria-live="polite"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-act="cancel">キャンセル</button>
          <button class="btn btn-primary" data-act="ok">OK</button>
        </div>
      </div>
    `;

    root.appendChild(wrap);
    const input = wrap.querySelector('#promptInput');
    const err = wrap.querySelector('#promptError');
    const close = (val) => {
      wrap.classList.add('modal-closing');
      setTimeout(() => {
        wrap.remove();
        resolve(val);
      }, 200);
    };

    const validate = () => {
      const v = String(input.value || '');
      if (!v.trim()) {
        err.textContent = '❌ 名称を入力してください';
        return false;
      }
      if (/[\\/:*?"<>|\u0000-\u001F]/.test(v)) {
        err.textContent = '❌ 使用できない文字が含まれています';
        return false;
      }
      if (v.length > 128) {
        err.textContent = '❌ 名称が長すぎます（128文字以内）';
        return false;
      }
      err.textContent = '';
      return true;
    };

    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) {
        close(null);
        return;
      }
      const actBtn = e.target.closest('button[data-act]');
      if (!actBtn) return;
      const act = actBtn.dataset.act;
      if (act === 'cancel') close(null);
      if (act === 'ok' && validate()) close(String(input.value || '').trim());
    });

    input.addEventListener('input', validate);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (validate()) close(String(input.value || '').trim());
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      }
    });

    setTimeout(() => {
      wrap.classList.add('modal-show');
      input.focus();
      input.select();
    }, 10);
  });
}

export function folderPickerModal(folders) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    if (!root) return resolve(null);

    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    const opts = [`<option value="">📁 なし</option>`].concat(
      folders.map(f => `<option value="${f.id}">📂 ${f.name}</option>`)
    ).join('');

    wrap.innerHTML = `
      <div role="dialog" aria-modal="true" class="modal modal-folder-picker">
        <div class="modal-header">
          <h3 class="modal-title">📁 フォルダに移動</h3>
          <button class="modal-close" data-act="cancel" aria-label="閉じる">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-field">
            <label class="form-label">移動先のフォルダを選択</label>
            <select id="folderSel" class="form-input">${opts}</select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-act="cancel">キャンセル</button>
          <button class="btn btn-primary" data-act="ok">移動</button>
        </div>
      </div>
    `;

    root.appendChild(wrap);
    const sel = wrap.querySelector('#folderSel');
    const close = (val) => {
      wrap.classList.add('modal-closing');
      setTimeout(() => {
        wrap.remove();
        resolve(val);
      }, 200);
    };

    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) {
        close(undefined);
        return;
      }
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'cancel') close(undefined);
      if (btn.dataset.act === 'ok') close(sel.value || null);
    });

    sel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(undefined);
      }
    });

    setTimeout(() => {
      wrap.classList.add('modal-show');
      sel.focus();
    }, 10);
  });
}
