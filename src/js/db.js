// db: メタデータ層（IndexedDB 実装）

const DB_NAME = 'otokura';
const DB_VERSION = 1;

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
  async getSettings(){
    const def = { id: 'singleton', playbackRate: 1.0, sortKey: 'addedAt', sortDir: 'desc' };
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
};

export { openDB };
