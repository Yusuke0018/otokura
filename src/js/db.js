// db: メタデータ層（IndexedDB 実装）

const DB_NAME = 'otokura';
const DB_VERSION = 3;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tracks')) {
        db.createObjectStore('tracks', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('playStats')) {
        db.createObjectStore('playStats', { keyPath: 'trackId' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains('fileChunks')) {
        db.createObjectStore('fileChunks', { keyPath: ['name', 'idx'] });
      }
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const p = Promise.resolve(fn(store));
    tx.oncomplete = () => resolve(p);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  async init(){ await openDB(); },
  async addTrack(track){
    return withStore('tracks', 'readwrite', s => s.put(track));
  },
  async updateTrack(id, patch){
    const current = await withStore('tracks', 'readonly', s => new Promise((res, rej)=>{
      const r = s.get(id); r.onsuccess = ()=> res(r.result); r.onerror = ()=> rej(r.error);
    }));
    if (!current) return;
    const next = { ...current, ...patch, updatedAt: Date.now() };
    return withStore('tracks', 'readwrite', s => s.put(next));
  },
  async listTracks(){
    return withStore('tracks', 'readonly', s => new Promise((res, rej)=>{
      const r = s.getAll ? s.getAll() : (()=>{ const arr=[]; const req=s.openCursor(); req.onsuccess=()=>{const c=req.result; if(c){arr.push(c.value); c.continue();} else res(arr)}; req.onerror=()=>rej(req.error); return {}})();
      if (r && 'onsuccess' in r) { r.onsuccess = ()=> res(r.result || []); r.onerror = ()=> rej(r.error); }
    }));
  },
  async removeTrack(id){
    return withStore('tracks', 'readwrite', s => s.delete(id));
  },
  async removePlayStats(trackId){
    return withStore('playStats', 'readwrite', s => s.delete(trackId));
  },
  async getSettings(){
    const def = {
      id: 'singleton',
      playbackRate: 1.0,
      sortKey: 'addedAt',
      sortDir: 'desc',
      shuffle: false,
      repeatAll: false,
      stopAfterCurrent: false,
    };
    const val = await withStore('settings', 'readonly', s => new Promise((res, rej)=>{
      const r = s.get('singleton'); r.onsuccess=()=>res(r.result||def); r.onerror=()=>rej(r.error);
    }));
    return { ...def, ...val };
  },
  async setSettings(settings){
    const val = { id: 'singleton', ...settings };
    return withStore('settings', 'readwrite', s => s.put(val));
  },
  async getPlayStats(trackId){
    const def = { trackId, playCount: 0, lastPlayedAt: 0, lastPositionMs: 0 };
    const val = await withStore('playStats', 'readonly', s => new Promise((res, rej)=>{
      const r = s.get(trackId); r.onsuccess=()=>res(r.result||def); r.onerror=()=>rej(r.error);
    }));
    return { ...def, ...val };
  },
  async setPlayStats(trackId, stats){
    const val = { trackId, ...stats };
    return withStore('playStats', 'readwrite', s => s.put(val));
  },
  // Folders
  async listFolders(){
    return withStore('folders', 'readonly', s => new Promise((res, rej)=>{
      const r = s.getAll ? s.getAll() : s.openCursor();
      if (r && 'onsuccess' in r && s.getAll){ r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }
      else { const items=[]; r.onsuccess=()=>{ const c=r.result; if(c){ items.push(c.value); c.continue(); } else res(items);}; r.onerror=()=>rej(r.error); }
    }));
  },
  async addFolder(folder){
    // folder: { id, name, createdAt, updatedAt }
    return withStore('folders', 'readwrite', s => s.put(folder));
  },
  async updateFolder(id, patch){
    const cur = await withStore('folders', 'readonly', s => new Promise((res, rej)=>{ const r=s.get(id); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);}));
    if (!cur) return;
    const next = { ...cur, ...patch, updatedAt: Date.now() };
    return withStore('folders', 'readwrite', s => s.put(next));
  },
  async removeFolder(id){
    // Remove folder and clear folderId from tracks
    const db = await openDB();
    await new Promise((res, rej)=>{
      const tx = db.transaction(['folders','tracks'], 'readwrite');
      const f = tx.objectStore('folders');
      const t = tx.objectStore('tracks');
      f.delete(id);
      const cursor = t.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result; if (c){
          const v = c.value; if (v.folderId === id){ c.update({ ...v, folderId: null, updatedAt: Date.now() }); }
          c.continue();
        }
      };
      tx.oncomplete=()=>res(true);
      tx.onerror=()=>rej(tx.error);
      tx.onabort=()=>rej(tx.error);
    });
  },
};

export { openDB };
