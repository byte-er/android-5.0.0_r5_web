// StorageManager: external storage volumes.
//  - "internal": /storage/emulated/0 (a.k.a. /sdcard) on the Origin Private
//    File System, falling back to IndexedDB where OPFS writes are unavailable
//  - "system":   read-only /system built from the resources extracted from AOSP
//  - local folders picked with the File System Access API (showDirectoryPicker)
import { db } from './db.js';
import { asset, listAssets } from './assets.js';
import { BUILD_PROPS } from '@gen';

export const join = (...p) => ('/' + p.join('/')).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
export const dirname = p => p.replace(/\/[^/]*$/, '') || '/';
export const basename = p => p.split('/').filter(Boolean).pop() || '/';
export const ext = p => (basename(p).match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
  ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac', mid: 'audio/midi', midi: 'audio/midi', mxmf: 'audio/mobile-xmf',
  mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', txt: 'text/plain', md: 'text/markdown', json: 'application/json', xml: 'text/xml',
  html: 'text/html', css: 'text/css', js: 'text/javascript', prop: 'text/plain', log: 'text/plain', csv: 'text/csv', vcf: 'text/vcard', pdf: 'application/pdf',
  zip: 'application/zip', wapk: 'application/vnd.android5web.wapk', apk: 'application/vnd.android.package-archive', ttf: 'font/ttf', wasm: 'application/wasm' };
export const mimeOf = p => MIME[ext(p)] || 'application/octet-stream';
export function kindOf(p) {
  const m = mimeOf(p), e = ext(p);
  if (e === 'wapk' || e === 'apk') return 'package';
  if (e === 'zip') return 'archive';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('text/') || m === 'application/json') return 'text';
  return 'file';
}
const toBlob = (data, path) => data instanceof Blob ? data : new Blob([data], { type: mimeOf(path) });

// ---------------------------------------------------------------- FileSystemDirectoryHandle backend (OPFS / picked folder)
class HandleVolume {
  constructor(id, label, root, { readOnly = false } = {}) { Object.assign(this, { id, label, rootP: Promise.resolve(root), readOnly }); }
  async dir(path, create = false) {
    let d = await this.rootP;
    for (const seg of path.split('/').filter(Boolean)) d = await d.getDirectoryHandle(seg, { create });
    return d;
  }
  async list(path) {
    const d = await this.dir(path), out = [];
    for await (const [name, hnd] of d.entries()) {
      if (hnd.kind === 'directory') out.push({ name, path: join(path, name), isDir: true, size: 0, mtime: 0 });
      else { const f = await hnd.getFile(); out.push({ name, path: join(path, name), isDir: false, size: f.size, mtime: f.lastModified }); }
    }
    return out;
  }
  async stat(path) {
    if (path === '/') return { name: '/', path, isDir: true };
    const parent = await this.dir(dirname(path)), name = basename(path);
    try { await parent.getDirectoryHandle(name); return { name, path, isDir: true, size: 0, mtime: 0 }; } catch {}
    try { const f = await (await parent.getFileHandle(name)).getFile(); return { name, path, isDir: false, size: f.size, mtime: f.lastModified }; } catch {}
    return null;
  }
  async readFile(path) { const f = await (await (await this.dir(dirname(path))).getFileHandle(basename(path))).getFile(); return f; }
  async writeFile(path, data) {
    const fh = await (await this.dir(dirname(path), true)).getFileHandle(basename(path), { create: true });
    const w = await fh.createWritable(); await w.write(toBlob(data, path)); await w.close();
  }
  async mkdir(path) { await this.dir(path, true); }
  async remove(path) { await (await this.dir(dirname(path))).removeEntry(basename(path), { recursive: true }); }
}

// ---------------------------------------------------------------- IndexedDB backend
class IdbVolume {
  constructor(id, label) { Object.assign(this, { id, label, readOnly: false }); }
  async all() { return db.all('files'); }
  async list(path) {
    return (await this.all()).filter(r => dirname(r.id) === path && r.id !== '/').map(r => ({ name: basename(r.id), path: r.id, isDir: r.dir, size: r.size || 0, mtime: r.mtime || 0 }));
  }
  async stat(path) { if (path === '/') return { name: '/', path, isDir: true }; const r = await db.get('files', path); return r ? { name: basename(path), path, isDir: r.dir, size: r.size || 0, mtime: r.mtime } : null; }
  async readFile(path) { const r = await db.get('files', path); if (!r || r.dir) throw new Error('Not a file: ' + path); return r.blob; }
  async ensureParents(path) { let p = dirname(path); const todo = []; while (p !== '/' && !(await db.get('files', p))) { todo.unshift(p); p = dirname(p); } for (const d of todo) await db.put('files', { id: d, dir: true, mtime: Date.now() }); }
  async writeFile(path, data) { const blob = toBlob(data, path); await this.ensureParents(path); await db.put('files', { id: path, dir: false, blob, size: blob.size, mtime: Date.now() }); }
  async mkdir(path) { await this.ensureParents(join(path, 'x')); if (!(await db.get('files', path))) await db.put('files', { id: path, dir: true, mtime: Date.now() }); }
  async remove(path) { for (const r of await this.all()) if (r.id === path || r.id.startsWith(path + '/')) await db.del('files', r.id); }
}

// ---------------------------------------------------------------- read-only /system from the AOSP resources in this build
const SYSTEM_MAP = [
  [/^font\/(.+)$/, '/fonts/$1'], [/^sound\/ringtones\/(.+)$/, '/media/audio/ringtones/$1'], [/^sound\/notifications\/(.+)$/, '/media/audio/notifications/$1'],
  [/^sound\/alarms\/(.+)$/, '/media/audio/alarms/$1'], [/^sound\/effects\/(.+)$/, '/media/audio/ui/$1'], [/^midi\/(.+)$/, '/media/midi/$1'],
  [/^wallpaper\/(.+)$/, '/media/wallpapers/$1'], [/^boot\/(.+)$/, '/framework/framework-res/assets/images/$1'],
  [/^tts\/(.+\.bin)$/, '/tts/lang_pico/$1'], [/^tts\/svoxpico\.wasm$/, '/lib/libsvoxpico.wasm'], [/^media\/sonivox\.wasm$/, '/lib/libsonivox.wasm'],
  [/^icon\/(.+)$/, '/app/icons/$1'],
];
class SystemVolume {
  constructor() {
    this.id = 'system'; this.label = 'System'; this.readOnly = true;
    this.files = new Map();
    for (const k of listAssets('')) for (const [re, to] of SYSTEM_MAP) if (re.test(k)) { this.files.set(k.replace(re, to), { asset: k }); break; }
    const prop = Object.entries(BUILD_PROPS).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    this.files.set('/build.prop', { text: '# begin build properties\n# autogenerated by web/tools/build.mjs\n' + prop + '# end build properties\n' });
  }
  async list(path) {
    const seen = new Map();
    for (const [p, f] of this.files) {
      if (!p.startsWith(path === '/' ? '/' : path + '/')) continue;
      const rest = p.slice(path === '/' ? 1 : path.length + 1).split('/');
      const name = rest[0], full = join(path, name);
      if (rest.length > 1) seen.set(name, { name, path: full, isDir: true, size: 0, mtime: 0 });
      else seen.set(name, { name, path: full, isDir: false, size: f.text ? f.text.length : 0, mtime: 0 });
    }
    return [...seen.values()];
  }
  async stat(path) { if (path === '/') return { name: '/', path, isDir: true }; if (this.files.has(path)) return { name: basename(path), path, isDir: false }; return (await this.list(dirname(path))).find(e => e.path === path) || null; }
  async readFile(path) {
    const f = this.files.get(path);
    if (!f) throw new Error('No such file');
    if (f.text) return new Blob([f.text], { type: 'text/plain' });
    return await (await fetch(asset(f.asset))).blob();
  }
  async writeFile() { throw new Error('Read-only file system'); }
  async mkdir() { throw new Error('Read-only file system'); }
  async remove() { throw new Error('Read-only file system'); }
}

// ---------------------------------------------------------------- StorageManager
const STANDARD_DIRS = ['Alarms', 'DCIM', 'Documents', 'Download', 'Movies', 'Music', 'Notifications', 'Pictures', 'Podcasts', 'Ringtones'];
let internalP = null;
async function createInternal() {
  try {
    if (navigator.storage && navigator.storage.getDirectory && 'createWritable' in FileSystemFileHandle.prototype) {
      const root = await navigator.storage.getDirectory();
      const sd = await root.getDirectoryHandle('sdcard', { create: true });
      const v = new HandleVolume('internal', 'Internal storage', sd);
      v.backend = 'Origin Private File System';
      return v;
    }
  } catch {}
  const v = new IdbVolume('internal', 'Internal storage');
  v.backend = 'IndexedDB';
  return v;
}
export function internalStorage() {
  if (!internalP) internalP = (async () => {
    const v = await createInternal();
    if (!localStorage.getItem('android5web.sdcard.init')) {
      for (const d of STANDARD_DIRS) await v.mkdir('/' + d).catch(() => {});
      await v.writeFile('/Download/README.txt', 'This is /sdcard, the shared external storage of Android 5.0 for the web.\n\n' +
        'Files here live in your browser (' + v.backend + ') and persist across reboots.\n' +
        'Copy .wapk packages here and open them to install apps.\n').catch(() => {});
      try { localStorage.setItem('android5web.sdcard.init', '1'); } catch {}
    }
    return v;
  })();
  return internalP;
}
let systemVol = null;
export const systemStorage = () => systemVol || (systemVol = new SystemVolume());
export const canPickFolders = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;
export async function pickFolder() {
  const h = await window.showDirectoryPicker({ mode: 'readwrite' });
  return new HandleVolume('local:' + h.name, h.name, h);
}
export async function usage() {
  try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, total: e.quota || 0 }; } catch { return { used: 0, total: 0 }; }
}

// Recursive helpers that work across volumes
export async function copyEntry(srcVol, src, dstVol, dst, onProgress) {
  const st = await srcVol.stat(src);
  if (st && st.isDir) {
    await dstVol.mkdir(dst);
    for (const e of await srcVol.list(src)) await copyEntry(srcVol, e.path, dstVol, join(dst, e.name), onProgress);
  } else {
    await dstVol.writeFile(dst, await srcVol.readFile(src));
    onProgress && onProgress(src);
  }
}
export async function walk(vol, path, out = [], depth = 0) {
  if (depth > 12) return out;
  for (const e of await vol.list(path).catch(() => [])) { if (e.isDir) await walk(vol, e.path, out, depth + 1); else out.push(e); }
  return out;
}
