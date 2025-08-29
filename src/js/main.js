// 音蔵: エントリポイント（最小雛形）
import { renderShell } from './ui.js';

function boot() {
  renderShell(document.getElementById('app'));
}

document.addEventListener('DOMContentLoaded', boot);

