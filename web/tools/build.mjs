#!/usr/bin/env node
// Android 5.0 web port: build script.
//
// 1. Pulls resources straight out of the AOSP 5.0.0_r5 tree (fonts, wallpapers,
//    boot animation textures, launcher/system icons, Material sound set,
//    SVOX Pico voice data, build properties).
// 2. Converts AOSP VectorDrawable XML (SystemUI + framework) into SVG.
// 3. Compiles external/svox/pico to WebAssembly (web/native/build.sh) if needed.
// 4. Bundles web/src with esbuild.
// 5. Writes two "finished HTML builds" into <repo>/releases:
//      releases/android-5.0-web/                 multi-file PWA (all voices/sounds)
//      releases/android-5.0-web-standalone.html  single self-contained file
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { vectorToSvg } from './vector2svg.mjs';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(WEB, '..');
const BUILD = path.join(WEB, 'build');
const GEN = path.join(BUILD, 'gen');
const REL = path.join(ROOT, 'releases');
const OUT_DIR = path.join(REL, 'android-5.0-web');
const OUT_SINGLE = path.join(REL, 'android-5.0-web-standalone.html');

const r = p => path.join(ROOT, p);
const exists = p => fs.existsSync(p);
const log = (...a) => console.log('[build]', ...a);

fs.mkdirSync(GEN, { recursive: true });

// ------------------------------------------------------------------ assets
// key -> { src, lite } ; lite=false keeps the asset out of the standalone file
const assets = {};
const add = (key, src, lite = true) => {
  const p = r(src);
  if (!exists(p)) { log('missing (skipped):', src); return; }
  assets[key] = { src: p, lite };
};

// fonts (frameworks/base/data/fonts)
for (const f of ['Roboto-Thin', 'Roboto-Light', 'Roboto-Regular', 'Roboto-Medium', 'Roboto-Bold', 'Roboto-Italic', 'RobotoCondensed-Regular', 'DroidSansMono'])
  add(`font/${f}.ttf`, `frameworks/base/data/fonts/${f}.ttf`);

// boot animation (frameworks/base/cmds/bootanimation uses these when no bootanimation.zip exists)
add('boot/android-logo-mask.png', 'frameworks/base/core/res/assets/images/android-logo-mask.png');
add('boot/android-logo-shine.png', 'frameworks/base/core/res/assets/images/android-logo-shine.png');

// wallpapers (downscaled below when Pillow is available)
const WALLPAPERS = {
  'wallpaper/lollipop.jpg': 'device/moto/shamu/overlay/frameworks/base/core/res/res/drawable-nodpi/default_wallpaper.jpg',
  'wallpaper/jellybean.jpg': 'frameworks/base/core/res/res/drawable-sw600dp-nodpi/default_wallpaper.jpg',
  'wallpaper/leaf.jpg': 'frameworks/base/core/res/res/drawable-sw720dp-nodpi/default_wallpaper.jpg',
};
for (const [k, v] of Object.entries(WALLPAPERS)) add(k, v);

// launcher icons
const ICONS = {
  phone: 'packages/apps/Dialer/res/mipmap-xxxhdpi/ic_launcher_phone.png',
  contacts: 'packages/apps/Contacts/res/drawable-xxxhdpi/logo_quick_contacts_color_44in48dp.png',
  messaging: 'packages/apps/Mms/res/mipmap-xxhdpi/ic_launcher_smsmms.png',
  browser: 'packages/apps/Browser/res/mipmap-xxhdpi/ic_launcher_browser.png',
  camera: 'packages/apps/Camera2/res_p/mipmap-xxxhdpi/logo_camera_color_44in48dp.png',
  gallery: 'packages/apps/Gallery2/res/mipmap-xhdpi/ic_launcher_gallery.png',
  settings: 'packages/apps/Settings/res/mipmap-xxxhdpi/ic_launcher_settings.png',
  calculator: 'packages/apps/Calculator/res/mipmap-xxxhdpi/ic_launcher_calculator.png',
  clock: 'packages/apps/DeskClock/res/mipmap-xxxhdpi/ic_launcher_alarmclock.png',
  calendar: 'packages/apps/Calendar/res/mipmap-xxhdpi/ic_launcher_calendar.png',
  email: 'packages/apps/Email/res/mipmap-xxxhdpi/ic_launcher_mail.png',
  music: 'packages/apps/Music/res/drawable-hdpi/app_music.png',
  recorder: 'packages/apps/SoundRecorder/res/drawable-hdpi/ic_launcher_soundrecorder.png',
  downloads: 'packages/providers/DownloadProvider/ui/res/mipmap-xxxhdpi/ic_launcher_download.png',
  wallpaper: 'packages/apps/Launcher3/WallpaperPicker/res/mipmap-xxhdpi/ic_launcher_wallpaper.png',
  home: 'packages/apps/Launcher3/res/mipmap-xxhdpi/ic_launcher_home.png',
  application: 'packages/apps/Launcher3/res/mipmap-xxhdpi/ic_launcher_application.png',
};
for (const [k, v] of Object.entries(ICONS)) add(`icon/${k}.png`, v);

// SystemUI navigation bar + misc bitmaps
for (const n of ['ic_sysbar_back', 'ic_sysbar_home', 'ic_sysbar_recent', 'ic_sysbar_back_ime', 'ic_sysbar_menu'])
  add(`sysui/${n}.png`, `frameworks/base/packages/SystemUI/res/drawable-xxhdpi/${n}.png`);
add('launcher/ic_allapps.png', 'packages/apps/Launcher3/res/drawable-xxhdpi/ic_allapps.png');

// Settings dashboard icons
const SETTINGS_ICONS = ['about', 'accessibility', 'accounts', 'applications', 'backup', 'battery', 'bluetooth2', 'data_usage',
  'date_time', 'development', 'display_am', 'home', 'language', 'location', 'more', 'multiuser', 'notifications',
  'print', 'security', 'sound', 'storage', 'wireless'];
for (const n of SETTINGS_ICONS) add(`settings/ic_settings_${n}.png`, `packages/apps/Settings/res/drawable-xxhdpi/ic_settings_${n}.png`);

// DeskClock tabs
for (const n of ['alarm', 'clock', 'timer', 'stopwatch'])
  add(`clock/ic_tab_${n}.png`, `packages/apps/DeskClock/res/drawable-xxhdpi/ic_tab_${n}_activated.png`);

// sounds: Material sound set (frameworks/base/data/sounds)
const S = 'frameworks/base/data/sounds';
for (const n of ['Effect_Tick', 'KeypressStandard', 'KeypressDelete', 'KeypressReturn', 'KeypressSpacebar', 'Lock', 'Unlock', 'Trusted', 'Media_Volume', 'Dock', 'Undock', 'VideoStop']) {
  const m = `${S}/effects/material/ogg/${n}.ogg`;
  add(`sound/effects/${n}.ogg`, exists(r(m)) ? m : `${S}/effects/ogg/${n}.ogg`);
}
for (const n of ['camera_click', 'VideoRecord', 'LowBattery', 'WirelessChargingStarted'])
  add(`sound/effects/${n}.ogg`, `${S}/effects/material/ogg/${n}.ogg`);
add('sound/effects/camera_focus.ogg', `${S}/effects/ogg/camera_focus.ogg`);
const LITE_SOUNDS = new Set(['Titania', 'Sedna', 'Luna', 'Osmium', 'Timer', 'Helium', 'Carbon']);
for (const kind of ['ringtones', 'notifications', 'alarms']) {
  const dir = r(`${S}/${kind}/material/ogg`);
  if (!exists(dir)) continue;
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.ogg') || f.includes('_48k')) continue;
    const name = f.replace('.ogg', '');
    add(`sound/${kind}/${f}`, `${S}/${kind}/material/ogg/${f}`, kind === 'notifications' || LITE_SOUNDS.has(name));
  }
}

// SVOX Pico voices (external/svox/pico/lang)
const VOICES = { 'en-US': 'lh0', 'en-GB': 'kh0', 'de-DE': 'gl0', 'es-ES': 'zl0', 'fr-FR': 'nk0', 'it-IT': 'cm0' };
for (const [lang, spk] of Object.entries(VOICES)) {
  add(`tts/${lang}_ta.bin`, `external/svox/pico/lang/${lang}_ta.bin`, lang === 'en-US');
  add(`tts/${lang}_${spk}_sg.bin`, `external/svox/pico/lang/${lang}_${spk}_sg.bin`, lang === 'en-US');
}

// ------------------------------------------------------------------ native (wasm)
const WASM = path.join(BUILD, 'native', 'svoxpico.wasm');
const nativeSrcs = [path.join(WEB, 'native/pico_web.c'), path.join(WEB, 'native/libc/libc.c'), path.join(WEB, 'native/build.sh')];
const stale = !exists(WASM) || nativeSrcs.some(s => fs.statSync(s).mtimeMs > fs.statSync(WASM).mtimeMs);
if (stale || process.argv.includes('--native')) {
  log('compiling external/svox/pico -> WebAssembly');
  try { execFileSync('sh', [path.join(WEB, 'native/build.sh')], { stdio: 'inherit' }); }
  catch (e) { log('WARNING: native build failed; TTS will be unavailable'); }
}
if (exists(WASM)) assets['tts/svoxpico.wasm'] = { src: WASM, lite: true };

// ------------------------------------------------------------------ wallpaper downscale
const processed = path.join(BUILD, 'processed');
fs.mkdirSync(path.join(processed, 'wallpaper'), { recursive: true });
for (const k of Object.keys(WALLPAPERS)) {
  if (!assets[k]) continue;
  const dst = path.join(processed, k);
  if (!exists(dst)) {
    try {
      execFileSync('python3', ['-I', '-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
im.thumbnail((1440, 1440), Image.LANCZOS)
im.save(sys.argv[2], 'JPEG', quality=84, optimize=True, progressive=True)`, assets[k].src, dst]);
    } catch { fs.copyFileSync(assets[k].src, dst); }
  }
  assets[k].src = dst;
}

// ------------------------------------------------------------------ vectors
const vectors = {};
const VECTOR_DIRS = [
  'frameworks/base/packages/SystemUI/res/drawable',
  'frameworks/base/core/res/res/drawable',
  'frameworks/base/core/res/res/drawable-nodpi',
];
for (const d of VECTOR_DIRS) {
  for (const f of fs.readdirSync(r(d))) {
    if (!f.endsWith('.xml')) continue;
    const xml = fs.readFileSync(r(`${d}/${f}`), 'utf8');
    if (!xml.includes('<vector')) continue;
    const name = f.replace('.xml', '');
    // multicolour drawables keep their colours; monochrome ones become tintable
    const colours = new Set([...xml.matchAll(/android:fillColor="#([0-9A-Fa-f]{6,8})"/g)].map(m => m[1].slice(-6).toUpperCase()));
    const keep = /^(pop_|platlogo|android$|moon|sun|star|cloud)/.test(name) || colours.size > 1 || (colours.size === 1 && ![...colours][0].match(/^(FFFFFF|000000)$/));
    const svg = vectorToSvg(xml, { currentColor: !keep });
    if (svg) vectors[name] = svg;
  }
}
log(`converted ${Object.keys(vectors).length} VectorDrawables to SVG`);

// ------------------------------------------------------------------ build info
const mk = fs.readFileSync(r('build/core/version_defaults.mk'), 'utf8');
const buildId = (fs.readFileSync(r('build/core/build_id.mk'), 'utf8').match(/BUILD_ID=(\S+)/) || [])[1] || 'LRX21Q';
const grab = (re, d) => (mk.match(re) || [])[1] || d;
const now = new Date();
const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
const buildinfo = {
  'ro.build.version.release': grab(/PLATFORM_VERSION := (\S+)/, '5.0'),
  'ro.build.version.sdk': grab(/PLATFORM_SDK_VERSION := (\S+)/, '21'),
  'ro.build.version.codename': 'REL',
  'ro.build.id': buildId,
  'ro.build.display.id': `aosp_web-userdebug 5.0 ${buildId} eng.${stamp} test-keys`,
  'ro.build.type': 'userdebug',
  'ro.build.tags': 'test-keys',
  'ro.build.date': now.toUTCString(),
  'ro.product.model': 'AOSP on Web',
  'ro.product.brand': 'Android',
  'ro.product.name': 'aosp_web',
  'ro.product.device': 'browser',
  'ro.product.cpu.abi': 'wasm32',
  'ro.config.ringtone': 'Titania.ogg',
  'ro.config.notification_sound': 'Tethys.ogg',
  'ro.config.alarm_alert': 'Osmium.ogg',
  'ro.source.tag': 'android-5.0.0_r5',
};
let gitRev = 'unknown';
try { gitRev = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD']).toString().trim(); } catch {}
buildinfo['ro.web.git_revision'] = gitRev;

// Strings pulled from AOSP resources (en) so UI text matches the platform
function strings(file, names) {
  const xml = fs.readFileSync(r(file), 'utf8');
  const out = {};
  for (const n of names) {
    const m = xml.match(new RegExp(`<string name="${n}"[^>]*>([\\s\\S]*?)</string>`));
    if (m) out[n] = m[1].replace(/<[^>]+>/g, '').replace(/\\u([0-9a-fA-F]{4})/g, (_, x) => String.fromCharCode(parseInt(x, 16)))
      .replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/^"(.*)"$/s, '$1').trim();
  }
  return out;
}
const aospStrings = {
  ...strings('frameworks/base/packages/SystemUI/res/values/strings.xml', [
    'quick_settings_wifi_label', 'quick_settings_bluetooth_label', 'quick_settings_flashlight_label', 'quick_settings_rotation_unlocked_label',
    'quick_settings_airplane_mode_label', 'quick_settings_location_label', 'quick_settings_inversion_label', 'quick_settings_hotspot_label',
    'quick_settings_cast_title', 'quick_settings_brightness_label', 'recents_empty_message', 'status_bar_clear_all_button',
    'keyguard_unlock', 'quick_settings_rotation_locked_portrait_label', 'accessibility_desc_lock_screen']),
  ...strings('packages/apps/Settings/res/values/strings.xml', [
    'wireless_networks_settings_title', 'device_section_title', 'personal_section_title', 'system_section_title',
    'wifi_settings_title', 'bluetooth_settings_title', 'data_usage_summary_title', 'radio_controls_title',
    'display_settings', 'notification_settings', 'storage_settings', 'power_usage_summary_title', 'applications_settings',
    'location_settings_title', 'security_settings_title', 'language_settings', 'accessibility_settings',
    'date_and_time', 'about_settings', 'tts_settings_title', 'tts_play_example_title', 'tts_default_rate_title',
    'tts_default_pitch_title', 'tts_engine_preference_section_title', 'wallpaper_settings_title', 'brightness', 'firmware_version',
    'build_number', 'model_number', 'kernel_version', 'baseband_version', 'device_info_settings', 'development_settings_title',
    'screen_timeout', 'font_size', 'sound_settings', 'ringtone_title', 'notification_sound_title', 'users_settings_title', 'backup_section_title', 'printing_settings']),
};

fs.writeFileSync(path.join(GEN, 'generated.js'),
  `// generated by web/tools/build.mjs from the AOSP tree - do not edit\n` +
  `export const VECTORS = ${JSON.stringify(vectors)};\n` +
  `export const BUILD_PROPS = ${JSON.stringify(buildinfo, null, 1)};\n` +
  `export const STRINGS = ${JSON.stringify(aospStrings, null, 1)};\n` +
  `export const VOICES = ${JSON.stringify(VOICES)};\n`);

// ------------------------------------------------------------------ bundle
const esbuild = await import('esbuild').catch(() => null);
if (!esbuild) { console.error('esbuild missing: run `npm install` in web/'); process.exit(1); }
const res = await esbuild.build({
  entryPoints: [path.join(WEB, 'src/js/main.js')],
  bundle: true, minify: !process.argv.includes('--dev'), format: 'iife', target: ['es2020'],
  write: false, legalComments: 'none', alias: { '@gen': path.join(GEN, 'generated.js') },
  logLevel: 'warning',
});
const js = res.outputFiles[0].text;
const cssFiles = fs.readdirSync(path.join(WEB, 'src/css')).filter(f => f.endsWith('.css')).sort();
const cssRaw = cssFiles.map(f => fs.readFileSync(path.join(WEB, 'src/css', f), 'utf8')).join('\n');
const css = (await esbuild.transform(cssRaw, { loader: 'css', minify: true })).code;

// ------------------------------------------------------------------ outputs
const mime = f => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.ogg': 'audio/ogg', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml' })[path.extname(f)] || 'application/octet-stream';

function fontFaces(urlOf) {
  const faces = [
    ['Roboto', 100, 'normal', 'Roboto-Thin'], ['Roboto', 300, 'normal', 'Roboto-Light'], ['Roboto', 400, 'normal', 'Roboto-Regular'],
    ['Roboto', 500, 'normal', 'Roboto-Medium'], ['Roboto', 700, 'normal', 'Roboto-Bold'], ['Roboto', 400, 'italic', 'Roboto-Italic'],
    ['Roboto Condensed', 400, 'normal', 'RobotoCondensed-Regular'], ['Droid Sans Mono', 400, 'normal', 'DroidSansMono'],
  ];
  return faces.filter(f => assets[`font/${f[3]}.ttf`]).map(([fam, w, s, file]) =>
    `@font-face{font-family:"${fam}";font-weight:${w};font-style:${s};font-display:block;src:url(${urlOf(`font/${file}.ttf`)}) format("truetype")}`).join('');
}

const template = fs.readFileSync(path.join(WEB, 'src/index.html'), 'utf8');
function page({ assetMap, fontCss, scriptTag, styleTag, extraHead = '', standalone = false }) {
  return template
    .replace('<html lang="en">', standalone ? '<html lang="en" data-standalone="1">' : '<html lang="en">')
    .replace('<!--STYLE-->', () => `<style>${fontCss}</style>${styleTag}`)
    .replace('<!--HEAD-->', () => extraHead)
    .replace('<!--SCRIPT-->', () => `<script>window.__ASSETS__=${JSON.stringify(assetMap)};</script>${scriptTag}`);
}

// (a) multi-file PWA
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
const assetMap = {};
for (const [k, a] of Object.entries(assets)) {
  const dst = path.join(OUT_DIR, 'assets', k);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(a.src, dst);
  assetMap[k] = 'assets/' + k;
}
fs.writeFileSync(path.join(OUT_DIR, 'app.js'), js);
fs.writeFileSync(path.join(OUT_DIR, 'app.css'), css);
const swList = ['./', 'index.html', 'app.js', 'app.css', 'manifest.webmanifest', ...Object.values(assetMap)];
fs.writeFileSync(path.join(OUT_DIR, 'sw.js'),
  fs.readFileSync(path.join(WEB, 'src/sw.js'), 'utf8')
    .replace('__VERSION__', `${buildinfo['ro.build.display.id']}-${gitRev}-${Date.now()}`)
    .replace('__PRECACHE__', JSON.stringify(swList)));
fs.writeFileSync(path.join(OUT_DIR, 'manifest.webmanifest'), JSON.stringify({
  name: 'Android 5.0 Lollipop', short_name: 'Android 5.0', start_url: './', display: 'fullscreen',
  orientation: 'portrait', background_color: '#000000', theme_color: '#000000',
  icons: [{ src: 'assets/icon/home.png', sizes: '144x144', type: 'image/png' }],
}, null, 1));
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), page({
  assetMap, fontCss: fontFaces(k => assetMap[k]),
  styleTag: '<link rel="stylesheet" href="app.css">',
  scriptTag: '<script src="app.js"></script>',
  extraHead: '<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="assets/icon/home.png">',
}));

// (b) single self-contained HTML
const dataMap = {};
for (const [k, a] of Object.entries(assets)) {
  if (!a.lite) continue;
  dataMap[k] = `data:${mime(a.src)};base64,${fs.readFileSync(a.src).toString('base64')}`;
}
const single = page({
  standalone: true,
  assetMap: dataMap, fontCss: fontFaces(k => dataMap[k]),
  styleTag: `<style>${css}</style>`,
  scriptTag: `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`,
  extraHead: `<link rel="icon" href="${dataMap['icon/home.png'] || ''}">`,
});
fs.writeFileSync(OUT_SINGLE, single);

const du = d => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? du(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
log(`wrote ${path.relative(ROOT, OUT_DIR)}/ (${(du(OUT_DIR) / 1048576).toFixed(1)} MB, ${Object.keys(assets).length} assets)`);
log(`wrote ${path.relative(ROOT, OUT_SINGLE)} (${(fs.statSync(OUT_SINGLE).size / 1048576).toFixed(1)} MB)`);
