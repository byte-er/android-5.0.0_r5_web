// PackageManagerService for WAPK packages (see web/docs/WAPK.md).
import { readZip, writeZip, sha256Hex } from './zip.js';
import { db } from './db.js';
import { App, registerApp, unregisterApp, sys, appManifest } from './system.js';
import { h, icon, vector, letterTile, fmtTime, fmtDate, drag, onLongPress, clamp } from './dom.js';
import * as ui from './ui.js';
import { nm } from './notifications.js';
import { click, playEffect, vibrate, audioCtx, streamVolume } from './sound.js';
import * as storage from './storage.js';
import { speak, stopSpeaking, ttsAvailable } from './tts.js';
import { prefs } from './prefs.js';
import { BUILD_PROPS } from '@gen';

export const WAPK_RUNTIME_VERSION = 1;
export const SDK_INT = Number(BUILD_PROPS['ro.build.version.sdk']) || 21;
const loaded = new Map(); // package -> { manifest, urls, style }

const STORAGE_PERMS = ['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE'];
const INSTALL_PERM = 'android.permission.REQUEST_INSTALL_PACKAGES';

// Human-readable permission labels (frameworks/base/core/res/res/values/strings.xml "permlab_*")
export const PERMISSION_LABELS = {
  'android.permission.READ_EXTERNAL_STORAGE': 'read the contents of your USB storage',
  'android.permission.WRITE_EXTERNAL_STORAGE': 'modify or delete the contents of your USB storage',
  'android.permission.INTERNET': 'full network access',
  'android.permission.ACCESS_NETWORK_STATE': 'view network connections',
  'android.permission.CHANGE_NETWORK_STATE': 'change network connectivity',
  'android.permission.ACCESS_WIFI_STATE': 'view Wi-Fi connections',
  'android.permission.CHANGE_WIFI_STATE': 'connect and disconnect from Wi-Fi',
  'android.permission.WAKE_LOCK': 'prevent device from sleeping',
  'android.permission.RECEIVE_BOOT_COMPLETED': 'run at startup',
  'com.android.launcher.permission.INSTALL_SHORTCUT': 'install shortcuts',
  'android.permission.REQUEST_INSTALL_PACKAGES': 'request install packages',
  'android.permission.GET_ACCOUNTS': 'find accounts on the device',
  'android.permission.VIBRATE': 'control vibration',
  'android.permission.FOREGROUND_SERVICE': 'run foreground service',
  'android.permission.CAMERA': 'take pictures and videos',
  'android.permission.RECORD_AUDIO': 'record audio',
  'android.permission.ACCESS_FINE_LOCATION': 'precise location (GPS and network-based)',
};
export const permissionLabel = p => PERMISSION_LABELS[p] || p.replace(/^.*\./, '').replace(/_/g, ' ').toLowerCase();

/** Parses and verifies a .wapk. Throws with a user-facing message on failure. */
export async function parseWapk(bytes) {
  let zip;
  try { zip = readZip(bytes); } catch { throw new Error('There was a problem parsing the package.'); }
  if (!zip.entries.has('WAPK-MANIFEST.json')) {
    if (zip.entries.has('AndroidManifest.xml')) {
      const err = new Error('This is an Android APK. Its Dalvik bytecode can’t run in the browser; convert it to a .wapk with web/tools/apk2wapk.mjs and a web implementation.');
      err.apk = true; throw err;
    }
    throw new Error('There was a problem parsing the package.');
  }
  let m;
  try { m = JSON.parse(await zip.text('WAPK-MANIFEST.json')); } catch { throw new Error('There was a problem parsing the package (invalid manifest).'); }
  if (m.wapk !== 1) throw new Error(`Unsupported WAPK format version ${m.wapk}.`);
  if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(m.package || '')) throw new Error('Invalid package name.');
  if ((m.minSdkVersion || 1) > SDK_INT) throw new Error(`This app requires Android API ${m.minSdkVersion}; this device runs API ${SDK_INT}.`);
  if ((m.minRuntime || 1) > WAPK_RUNTIME_VERSION) throw new Error('This app needs a newer WAPK runtime.');
  for (const f of [m.entry, m.icon, ...(m.styles || [])].filter(Boolean)) if (!zip.entries.has(f)) throw new Error(`Package is missing ${f}.`);
  const files = {};
  for (const e of zip.entries.values()) {
    if (e.dir) continue;
    const data = await zip.read(e);
    if (m.files && m.files[e.name] && m.files[e.name] !== await sha256Hex(data)) throw new Error(`Package is corrupt: checksum mismatch for ${e.name}.`);
    files[e.name] = new Blob([data], { type: storage.mimeOf(e.name) });
  }
  for (const f of Object.keys(m.files || {})) if (!files[f]) throw new Error(`Package is missing ${f}.`);
  const source = files['META-INF/SOURCE.json'] ? JSON.parse(await files['META-INF/SOURCE.json'].text()) : null;
  return { manifest: m, files, source, iconUrl: m.icon ? URL.createObjectURL(files[m.icon]) : null };
}

export const installedPackage = pkg => db.get('packages', pkg);
export async function installedPackages() { return (await db.all('packages')).sort((a, b) => a.manifest.label.localeCompare(b.manifest.label)); }

export async function installParsed(parsed) {
  const { manifest: m, files, source } = parsed;
  const prev = await db.get('packages', m.package);
  if (prev && prev.manifest.versionCode > m.versionCode) throw new Error('App not installed: a newer version is already installed.');
  const rec = { id: m.package, manifest: m, files, source, installedAt: prev ? prev.installedAt : Date.now(), updatedAt: Date.now() };
  await db.put('packages', rec);
  const t = sys.findTask(m.package);
  if (t) sys.destroy(t);
  await load(rec);
  sys.emit('package-added', m.package, !prev);
  return rec;
}

export async function uninstall(pkg) {
  const t = sys.findTask(pkg);
  if (t) sys.destroy(t);
  unload(pkg);
  await db.del('packages', pkg);
  try { localStorage.removeItem('android5web.app.' + pkg); } catch {}
  sys.emit('package-removed', pkg);
}

function unload(pkg) {
  const l = loaded.get(pkg);
  if (!l) return;
  l.urls.forEach(u => URL.revokeObjectURL(u));
  l.style && l.style.remove();
  loaded.delete(pkg);
  unregisterApp(pkg);
}

async function load(rec) {
  const m = rec.manifest;
  unload(m.package);
  const urls = [];
  const url = name => { const b = rec.files[name]; if (!b) return null; const u = URL.createObjectURL(b); urls.push(u); return u; };
  let style = null;
  if (m.styles && m.styles.length) {
    style = document.createElement('style');
    style.dataset.package = m.package;
    style.textContent = (await Promise.all(m.styles.map(s => rec.files[s].text()))).join('\n');
    document.head.append(style);
  }
  const iconUrl = url(m.icon);
  const entryUrl = URL.createObjectURL(new Blob([await rec.files[m.entry].text()], { type: 'text/javascript' }));
  urls.push(entryUrl);
  const mod = await import(/* webpackIgnore: true */ entryUrl);
  const api = createRuntime(rec, url);
  const AppClass = (mod.default || mod.createApp)(api);
  if (typeof AppClass !== 'function') throw new Error('WAPK entry did not return an App class');
  const theme = m.theme || {};
  registerApp({
    id: m.package, label: m.label, iconUrl, wapk: true, pkg: m.package, version: m.versionName, versionCode: m.versionCode,
    color: theme.colorPrimary || '#607d8b', colorDark: theme.colorPrimaryDark || theme.colorPrimary || '#455a64', accent: theme.colorAccent || '#009688',
    fullscreen: !!m.fullscreen, permissions: m.permissions || [],
  }, AppClass);
  loaded.set(m.package, { manifest: m, urls, style });
}

/** Loads every installed package at boot. Broken packages are skipped (and reported). */
export async function loadInstalledPackages() {
  for (const rec of await db.all('packages')) {
    try { await load(rec); } catch (e) { console.error('Failed to load package', rec.id, e); }
  }
}

// The API object handed to a WAPK's entry module: `export default android => class extends android.App {}`
function createRuntime(rec, url) {
  const m = rec.manifest, perms = new Set(m.permissions || []);
  const require = (cond, what) => { if (!cond) throw new DOMException(`${m.package} lacks permission for ${what}`, 'SecurityError'); };
  const appPrefsKey = 'android5web.app.' + m.package;
  const api = {
    runtimeVersion: WAPK_RUNTIME_VERSION,
    SDK_INT, buildProps: { ...BUILD_PROPS },
    manifest: JSON.parse(JSON.stringify(m)),
    App,
    h, icon, vector, letterTile, fmtTime, fmtDate, drag, onLongPress, clamp,
    ui: { toolbar: ui.toolbar, listItem: ui.listItem, switchItem: ui.switchItem, switchEl: ui.switchEl, checkbox: ui.checkbox, subheader: ui.subheader,
      divider: ui.divider, slider: ui.slider, button: ui.button, fab: ui.fab, dialog: ui.dialog, prompt: ui.prompt, toast: ui.toast,
      popupMenu: ui.popupMenu, PageStack: ui.PageStack, tabs: ui.tabs, emptyState: ui.emptyState },
    sound: { click, playEffect, vibrate, audioContext: audioCtx, mediaVolume: () => streamVolume('media') },
    zip: { readZip, writeZip },
    is24HourFormat: () => !!prefs.get('time_24'),
    resource: name => url(name),
    readResource: async name => rec.files[name] ? rec.files[name] : null,
    notify: n => nm.notify({ ...n, appId: m.package, id: n.id ? m.package + ':' + n.id : undefined }),
    cancelNotification: id => nm.cancel(m.package + ':' + id),
    startActivity: (pkg, intent) => sys.launch(pkg, intent || {}),
    prefs: {
      get(k, d) { try { const o = JSON.parse(localStorage.getItem(appPrefsKey) || '{}'); return k in o ? o[k] : d; } catch { return d; } },
      set(k, v) { try { const o = JSON.parse(localStorage.getItem(appPrefsKey) || '{}'); o[k] = v; localStorage.setItem(appPrefsKey, JSON.stringify(o)); } catch {} },
    },
    get storage() {
      require(STORAGE_PERMS.some(p => perms.has(p)), 'external storage');
      return { internal: storage.internalStorage, system: storage.systemStorage, canPickFolders: storage.canPickFolders, pickFolder: storage.pickFolder,
        usage: storage.usage, copy: storage.copyEntry, walk: storage.walk, join: storage.join, dirname: storage.dirname, basename: storage.basename,
        ext: storage.ext, mimeOf: storage.mimeOf, kindOf: storage.kindOf, readOnly: !perms.has('android.permission.WRITE_EXTERNAL_STORAGE') };
    },
    // TextToSpeech (SVOX Pico in WebAssembly)
    tts: { available: ttsAvailable, speak: (text, opts) => speak(text, opts), stop: stopSpeaking },
    // Camera / microphone through getUserMedia, gated by CAMERA / RECORD_AUDIO
    media: {
      getUserMedia(constraints = {}) {
        if (constraints.audio) require(perms.has('android.permission.RECORD_AUDIO'), 'the microphone');
        if (constraints.video) require(perms.has('android.permission.CAMERA'), 'the camera');
        return navigator.mediaDevices.getUserMedia(constraints);
      },
    },
    // ACTION_INSTALL_PACKAGE: hands bytes to the system PackageInstaller
    installPackage(bytes, name) {
      require(perms.has(INSTALL_PERM), 'installing packages');
      return sys.launch('packageinstaller', { bytes, name, from: m.package });
    },
  };
  return Object.freeze(api);
}

export const isWapk = id => !!(appManifest(id) || {}).wapk;
