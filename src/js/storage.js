// storage: OPFS/IDB 抽象層（MVP実装）
import { openDB } from './db.js';

const supportsOPFS = !!(navigator.storage && navigator.storage.getDirectory);
const CHUNK_SIZE = 8 * 1024 * 1024; // 8MiB - チャンクサイズ（分割保存の単位）
const CHUNK_THRESHOLD = 32 * 1024 * 1024; // 32MiB 以上は分割保存（IndexedDB）
// 注: OPFS使用時はストリーミング処理により無制限のファイルサイズに対応
// IndexedDB使用時もチャンク分割により大容量ファイルを安全に保存可能

function sanitize(name){
  return String(name || 'unnamed').replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').slice(0, 255);
}

async function getDir(){
  const root = await navigator.storage.getDirectory();
  try { return await root.getDirectoryHandle('tracks', { create: true }); }
  catch { return root; }
}

async function opfsExists(dir, name){
  try { await dir.getFileHandle(name); return true; } catch { return false; }
}

async function idbHasFile(name){
  const db = await openDB();
  return await new Promise((res, rej)=>{
    const tx = db.transaction('files', 'readonly');
    const s = tx.objectStore('files');
    const r = s.get(name);
    r.onsuccess = () => res(!!r.result);
    r.onerror = () => rej(r.error);
  });
}

async function ensureUniqueName(name){
  const base = sanitize(name);
  if (supportsOPFS){
    const dir = await getDir();
    if (!(await opfsExists(dir, base))) return base;
    let i = 1;
    while (await opfsExists(dir, `${base} (${i})`)) i++;
    return `${base} (${i})`;
  } else {
    if (!(await idbHasFile(base))) return base;
    let i = 1;
    while (await idbHasFile(`${base} (${i})`)) i++;
    return `${base} (${i})`;
  }
}

export const storage = {
  async exists(name){
    name = sanitize(name);
    if (supportsOPFS){
      const dir = await getDir();
      try { await dir.getFileHandle(name, { create: false }); return true; } catch { return false; }
    } else {
      const db = await openDB();
      return await new Promise((res)=>{
        const tx = db.transaction('files', 'readonly');
        const s = tx.objectStore('files');
        const r = s.get(name);
        r.onsuccess=()=>res(!!r.result);
        r.onerror=()=>res(false);
      });
    }
  },
  async saveFile(name, blob){
    const unique = await ensureUniqueName(name);
    if (supportsOPFS){
      const dir = await getDir();
      const handle = await dir.getFileHandle(unique, { create: true });
      const ws = await handle.createWritable();
      if (blob && blob.stream && ws && ws.write) {
        // Chrome系: ストリーミングで大容量でも安定
        await blob.stream().pipeTo(ws);
      } else {
        // 後方互換
        await ws.write(blob);
        await ws.close();
      }
      return unique;
    } else {
      const db = await openDB();
      if (blob.size >= CHUNK_THRESHOLD) {
        // 分割保存（大容量対応）
        const total = blob.size;
        const chunks = Math.ceil(total / CHUNK_SIZE);
        return await new Promise((resolve, reject)=>{
          const tx = db.transaction(['files','fileChunks'], 'readwrite');
          const meta = tx.objectStore('files');
          const chunkStore = tx.objectStore('fileChunks');
          for (let i=0; i<chunks; i++){
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, total);
            const part = blob.slice(start, end);
            chunkStore.put({ name: unique, idx: i, blob: part });
          }
          meta.put({ name: unique, size: blob.size, type: blob.type, addedAt: Date.now(), chunked: true, chunkSize: CHUNK_SIZE, chunks });
          tx.oncomplete=()=>resolve(unique);
          tx.onerror=()=>reject(tx.error);
          tx.onabort=()=>reject(tx.error);
        });
      } else {
        // そのまま保存
        return await new Promise((resolve, reject)=>{
          const tx = db.transaction('files', 'readwrite');
          const s = tx.objectStore('files');
          s.put({ name: unique, blob, size: blob.size, type: blob.type, addedAt: Date.now(), chunked: false });
          tx.oncomplete=()=>resolve(unique);
          tx.onerror=()=>reject(tx.error);
          tx.onabort=()=>reject(tx.error);
        });
      }
    }
  },
  async listFiles(){
    if (supportsOPFS){
      const dir = await getDir();
      const entries = [];
      for await (const [name, handle] of dir.entries()){
        if (handle.kind === 'file') entries.push({ name });
      }
      return entries;
    } else {
      const db = await openDB();
      return await new Promise((res, rej)=>{
        const tx = db.transaction('files', 'readonly');
        const s = tx.objectStore('files');
        const r = s.getAll ? s.getAll() : s.openCursor();
        if (r && 'onsuccess' in r && s.getAll){
          r.onsuccess=()=>res((r.result||[]).map(x=>({ name: x.name })));
          r.onerror=()=>rej(r.error);
        } else {
          const items=[]; r.onsuccess=()=>{ const c=r.result; if(c){ items.push({ name: c.value.name }); c.continue(); } else res(items);}; r.onerror=()=>rej(r.error);
        }
      });
    }
  },
  async getFile(name){
    if (supportsOPFS){
      const dir = await getDir();
      const h = await dir.getFileHandle(name);
      return await h.getFile();
    } else {
      const db = await openDB();
      const meta = await new Promise((res, rej)=>{
        const tx = db.transaction('files', 'readonly');
        const s = tx.objectStore('files');
        const r = s.get(name);
        r.onsuccess=()=>res(r.result||null);
        r.onerror=()=>rej(r.error);
      });
      if (!meta) return null;
      if (!meta.chunked) return meta.blob || null;
      // 分割再構成
      return await new Promise((res, rej)=>{
        const tx = db.transaction('fileChunks', 'readonly');
        const s = tx.objectStore('fileChunks');
        const range = IDBKeyRange.bound([name, 0], [name, meta.chunks]);
        const parts = [];
        const req = s.openCursor(range);
        req.onsuccess = () => {
          const cur = req.result;
          if (cur){ parts.push(cur.value.blob); cur.continue(); }
          else res(new Blob(parts, { type: meta.type }));
        };
        req.onerror = () => rej(req.error);
      });
    }
  },
  async rename(oldName, newName){
    const unique = await ensureUniqueName(newName);
    if (supportsOPFS){
      const dir = await getDir();
      const src = await dir.getFileHandle(oldName);
      const dst = await dir.getFileHandle(unique, { create: true });
      const srcFile = await src.getFile();
      const ws = await dst.createWritable();
      await ws.write(srcFile);
      await ws.close();
      await dir.removeEntry(oldName);
      return unique;
    } else {
      const db = await openDB();
      return await new Promise((res, rej)=>{
        const tx = db.transaction(['files','fileChunks'], 'readwrite');
        const files = tx.objectStore('files');
        const chunks = tx.objectStore('fileChunks');
        const g = files.get(oldName);
        g.onsuccess = () => {
          const v = g.result; if(!v){ res(null); return; }
          if (v.chunked){
            const range = IDBKeyRange.bound([oldName, 0], [oldName, v.chunks]);
            const curReq = chunks.openCursor(range);
            curReq.onsuccess = () => {
              const c = curReq.result;
              if (c){
                const { idx, blob } = c.value;
                chunks.put({ name: unique, idx, blob });
                chunks.delete([oldName, idx]);
                c.continue();
              }
            };
          }
          files.put({ ...v, name: unique });
          files.delete(oldName);
        };
        tx.oncomplete=()=>res(unique);
        tx.onerror=()=>rej(tx.error);
        tx.onabort=()=>rej(tx.error);
      });
    }
  },
  async renameExact(oldName, newName){
    const target = sanitize(newName);
    if (supportsOPFS){
      const dir = await getDir();
      // 存在チェック
      try { await dir.getFileHandle(target, { create: false }); return null; } catch {}
      const src = await dir.getFileHandle(oldName);
      const dst = await dir.getFileHandle(target, { create: true });
      const srcFile = await src.getFile();
      const ws = await dst.createWritable();
      await ws.write(srcFile);
      await ws.close();
      await dir.removeEntry(oldName);
      return target;
    } else {
      const db = await openDB();
      const exists = await new Promise((res)=>{
        const tx = db.transaction('files', 'readonly');
        const s = tx.objectStore('files');
        const r = s.get(target); r.onsuccess=()=>res(!!r.result); r.onerror=()=>res(false);
      });
      if (exists) return null;
      return await new Promise((res, rej)=>{
        const tx = db.transaction(['files','fileChunks'], 'readwrite');
        const files = tx.objectStore('files');
        const chunks = tx.objectStore('fileChunks');
        const g = files.get(oldName);
        g.onsuccess = () => {
          const v = g.result; if(!v){ res(null); return; }
          if (v.chunked){
            const range = IDBKeyRange.bound([oldName, 0], [oldName, v.chunks]);
            const curReq = chunks.openCursor(range);
            curReq.onsuccess = () => {
              const c = curReq.result;
              if (c){ const { idx, blob } = c.value; chunks.put({ name: target, idx, blob }); chunks.delete([oldName, idx]); c.continue(); }
            };
          }
          files.put({ ...v, name: target });
          files.delete(oldName);
        };
        tx.oncomplete=()=>res(target);
        tx.onerror=()=>rej(tx.error);
        tx.onabort=()=>rej(tx.error);
      });
    }
  },
  async remove(name){
    if (supportsOPFS){
      const dir = await getDir();
      await dir.removeEntry(name);
      return true;
    } else {
      const db = await openDB();
      const meta = await new Promise((res, rej)=>{
        const tx = db.transaction('files', 'readonly');
        const s = tx.objectStore('files');
        const r = s.get(name);
        r.onsuccess=()=>res(r.result||null);
        r.onerror=()=>rej(r.error);
      });
      return await new Promise((res, rej)=>{
        const tx = db.transaction(['files','fileChunks'], 'readwrite');
        tx.objectStore('files').delete(name);
        if (meta?.chunked){
          const s = tx.objectStore('fileChunks');
          const range = IDBKeyRange.bound([name, 0], [name, meta.chunks]);
          const cursor = s.openCursor(range);
          cursor.onsuccess = () => {
            const c = cursor.result; if (c){ s.delete(c.primaryKey); c.continue(); }
          };
        }
        tx.oncomplete=()=>res(true);
        tx.onerror=()=>rej(tx.error);
        tx.onabort=()=>rej(tx.error);
      });
    }
  },
};
