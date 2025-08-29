// storage: OPFS/IDB 抽象層（MVP実装）
import { openDB } from './db.js';

const supportsOPFS = !!(navigator.storage && navigator.storage.getDirectory);

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

async function ensureUniqueName(name){
  const base = sanitize(name);
  if (supportsOPFS){
    const dir = await getDir();
    if (!(await opfsExists(dir, base))) return base;
    let i = 1;
    while (await opfsExists(dir, `${base} (${i})`)) i++;
    return `${base} (${i})`;
  } else {
    const db = await openDB();
    const tx = db.transaction('files', 'readonly');
    const s = tx.objectStore('files');
    const has = (n)=> new Promise(res=>{ const r=s.getKey?n=>{ const g=s.get(n); g.onsuccess=()=>res(!!g.result); g.onerror=()=>res(false);} : null; if(r){r(n)} else { const g=s.get(n); g.onsuccess=()=>res(!!g.result); g.onerror=()=>res(false);} });
    if (!(await has(base))) return base;
    let i = 1;
    while (await has(`${base} (${i})`)) i++;
    return `${base} (${i})`;
  }
}

export const storage = {
  async saveFile(name, blob){
    const unique = await ensureUniqueName(name);
    if (supportsOPFS){
      const dir = await getDir();
      const handle = await dir.getFileHandle(unique, { create: true });
      const ws = await handle.createWritable();
      await ws.write(blob);
      await ws.close();
      return unique;
    } else {
      const db = await openDB();
      return await new Promise((resolve, reject)=>{
        const tx = db.transaction('files', 'readwrite');
        const s = tx.objectStore('files');
        s.put({ name: unique, blob, size: blob.size, type: blob.type, addedAt: Date.now() });
        tx.oncomplete=()=>resolve(unique);
        tx.onerror=()=>reject(tx.error);
        tx.onabort=()=>reject(tx.error);
      });
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
      return await new Promise((res, rej)=>{
        const tx = db.transaction('files', 'readonly');
        const s = tx.objectStore('files');
        const r = s.get(name);
        r.onsuccess=()=>res(r.result?.blob||null);
        r.onerror=()=>rej(r.error);
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
        const tx = db.transaction('files', 'readwrite');
        const s = tx.objectStore('files');
        const g = s.get(oldName);
        g.onsuccess = () => {
          const v = g.result; if(!v){ res(null); return; }
          s.put({ ...v, name: unique });
          s.delete(oldName);
        };
        tx.oncomplete=()=>res(unique);
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
      return await new Promise((res, rej)=>{
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').delete(name);
        tx.oncomplete=()=>res(true);
        tx.onerror=()=>rej(tx.error);
        tx.onabort=()=>rej(tx.error);
      });
    }
  },
};
