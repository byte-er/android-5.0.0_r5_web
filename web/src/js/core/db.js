// Tiny IndexedDB wrapper: a ContentProvider-like store per collection.
const DB = 'android5web';
const STORES = ['media', 'contacts', 'calls', 'messages', 'events', 'alarms', 'recordings', 'kv'];
let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const rq = indexedDB.open(DB, 2);
    rq.onupgradeneeded = () => { for (const s of STORES) if (!rq.result.objectStoreNames.contains(s)) rq.result.createObjectStore(s, { keyPath: 'id', autoIncrement: true }); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return dbp;
}
function tx(store, mode, fn) {
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
    t.onerror = () => rej(t.error);
  }));
}
const memory = {};
let failed = false;
function safe(p, fallback) { return p.catch(() => { failed = true; return fallback(); }); }
export const db = {
  all: s => safe(tx(s, 'readonly', st => st.getAll()), () => Object.values(memory[s] || {})),
  get: (s, id) => safe(tx(s, 'readonly', st => st.get(id)), () => (memory[s] || {})[id]),
  put: (s, obj) => safe(tx(s, 'readwrite', st => st.put(obj)), () => { memory[s] = memory[s] || {}; obj.id = obj.id || Date.now() + Math.random(); memory[s][obj.id] = obj; return obj.id; }),
  del: (s, id) => safe(tx(s, 'readwrite', st => st.delete(id)), () => { delete (memory[s] || {})[id]; }),
  clear: s => safe(tx(s, 'readwrite', st => st.clear()), () => { memory[s] = {}; }),
  get failed() { return failed; },
};
