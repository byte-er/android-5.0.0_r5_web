// Android 5.0 (Lollipop) for the web - boot & SystemServer equivalent.
import { h, installRipples, sleep } from './core/dom.js';
import { prefs } from './core/prefs.js';
import { sys } from './core/system.js';
import { setOverlayRoot, toast } from './core/ui.js';
import { nm } from './core/notifications.js';
import { playEffect } from './core/sound.js';
import { speak, ttsAvailable } from './core/tts.js';
import { bootAnimation } from './systemui/bootanim.js';
import { createStatusBar } from './systemui/statusbar.js';
import { createNavBar } from './systemui/navbar.js';
import { createShade } from './systemui/shade.js';
import { createKeyguard } from './systemui/keyguard.js';
import { createRecents } from './systemui/recents.js';
import { createVolumePanel } from './systemui/volume.js';
import { globalActions, createScreenOff } from './systemui/power.js';
import { createLauncher, applyWallpaper } from './launcher/launcher.js';
import { BUILD_PROPS } from '@gen';
import { startAlarmService } from './apps/clock.js';
import './apps/index.js';

const params = new URLSearchParams(location.search);

function buildDevice() {
  const screen = h('div#screen');
  const device = h('div#device', null,
    h('div.hw.hw-power', { title: 'Power (Alt+P)' }), h('div.hw.hw-volup', { title: 'Volume up (PgUp)' }), h('div.hw.hw-voldown', { title: 'Volume down (PgDn)' }),
    h('div.bezel-top', h('div.speaker'), h('div.camera-dot')), screen, h('div.bezel-bottom'));
  const help = h('aside#help', null,
    h('h1', `Android ${BUILD_PROPS['ro.build.version.release']} Lollipop`),
    h('p', `Built from AOSP ${BUILD_PROPS['ro.source.tag']} (${BUILD_PROPS['ro.build.id']}), running in your browser.`),
    h('table', null, ...[['Esc', 'Back'], ['Alt+H / Home', 'Home'], ['Alt+R / End', 'Overview (recents)'], ['Alt+N', 'Notifications'], ['Alt+P', 'Power (hold: menu)'], ['PgUp / PgDn', 'Volume']]
      .map(([k, v]) => h('tr', h('td', h('kbd', k)), h('td', v)))),
    h('p.small', 'Tip: swipe down from the status bar, long-press the home screen, and tap "Android version" in Settings > About phone a few times.'));
  document.getElementById('stage').append(device, help);
  return { screen, device };
}

function fit(device, screen) {
  const mobile = window.matchMedia('(max-width: 600px), (max-height: 520px), (pointer: coarse) and (max-width: 900px)').matches || params.has('fullscreen');
  document.body.classList.toggle('mobile', mobile);
  if (mobile) { device.style.transform = ''; return; }
  const W = device.offsetWidth, H = device.offsetHeight;
  const avail = window.innerHeight - 24, availW = window.innerWidth - (window.innerWidth > 1000 ? 380 : 24);
  const k = Math.min(1.25, avail / H, availW / W);
  device.style.transform = `scale(${k})`;
}

async function main() {
  const { screen, device } = buildDevice();
  fit(device, screen);
  window.addEventListener('resize', () => fit(device, screen));
  installRipples(screen);

  // ---- window layers (bottom -> top)
  const wallpaper = h('div#wallpaper');
  const windows = h('div#windows');
  screen.append(wallpaper);
  const launcher = createLauncher(screen, wallpaper);
  screen.append(windows);
  sys.attach(screen, windows, launcher.root);
  sys.openWallpaperPicker = launcher.openWallpaperPicker;
  const recents = createRecents(screen);
  const statusbar = createStatusBar();
  screen.append(statusbar);
  const shade = createShade(screen, statusbar);
  const keyguard = createKeyguard(screen);
  const navbar = createNavBar({
    onBack: () => { if (keyguard.isShowing()) { keyguard.back(); return; } sys.back(); },
    onHome: () => { if (keyguard.isShowing()) return; shade.close(); recents.close(); sys.backStack.slice().reverse().forEach(f => { try { f(); } catch {} }); sys.home(); },
    onRecents: () => { if (keyguard.isShowing()) return; shade.close(); recents.open(); },
    onHomeLong: () => { if (!keyguard.isShowing() && ttsAvailable()) speak('Hello! I am the SVOX Pico text to speech engine, compiled to WebAssembly.'); },
  });
  screen.append(navbar);
  const volume = createVolumePanel(screen);
  const overlay = h('div#overlay');
  screen.append(overlay);
  setOverlayRoot(overlay);
  const dim = h('div#dim'), touches = h('div#touches');
  screen.append(dim, touches);
  const screenOff = createScreenOff(screen);
  const bootLayer = h('div#boot');
  screen.append(bootLayer);
  sys.on('open-shade', () => shade.open());

  // ---- chrome (status/nav bar colours follow the foreground task)
  const chrome = () => {
    const t = sys.current;
    const onHome = !t && !recents.isOpen();
    screen.classList.toggle('on-home', onHome);
    screen.classList.toggle('in-recents', recents.isOpen());
    screen.classList.toggle('task-fullscreen', !!(t && t.fullscreen) && !recents.isOpen());
    statusbar.style.background = onHome || recents.isOpen() || keyguard.isShowing() ? '' : (t && t.statusColor) || '#000';
    statusbar.classList.toggle('light-bg', false);
  };
  sys.on('chrome', chrome); sys.on('recents', chrome); sys.on('lock', chrome); sys.on('task', chrome);

  // ---- settings with system-wide effect
  const applyBrightness = () => { dim.style.opacity = String(1 - prefs.get('brightness')); };
  const applyInvert = () => screen.classList.toggle('inverted', !!prefs.get('invert'));
  const applyFont = () => screen.style.setProperty('--font-scale', String(prefs.get('large_text') ? 1.3 : prefs.get('font_scale')));
  const applyDev = () => { screen.classList.toggle('show-bounds', !!prefs.get('show_bounds')); screen.style.setProperty('--anim-scale', String(prefs.get('anim_scale'))); };
  prefs.on('brightness', applyBrightness); prefs.on('invert', applyInvert); prefs.on('font_scale', applyFont); prefs.on('large_text', applyFont);
  prefs.on('show_bounds', applyDev); prefs.on('anim_scale', applyDev); prefs.on('wallpaper', () => applyWallpaper(wallpaper));
  applyBrightness(); applyInvert(); applyFont(); applyDev(); applyWallpaper(wallpaper);

  // show touches (developer option)
  screen.addEventListener('pointerdown', e => {
    if (!prefs.get('show_touches')) return;
    const s = screen.getBoundingClientRect(), k = s.width / screen.offsetWidth;
    const dot = h('div.touch-dot', { style: { left: (e.clientX - s.left) / k + 'px', top: (e.clientY - s.top) / k + 'px' } });
    touches.append(dot);
    const mv = ev => { dot.style.left = (ev.clientX - s.left) / k + 'px'; dot.style.top = (ev.clientY - s.top) / k + 'px'; };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', () => { window.removeEventListener('pointermove', mv); dot.remove(); }, { once: true });
  }, true);

  // TalkBack-lite: speak what is touched using the Pico engine
  screen.addEventListener('click', e => {
    if (!prefs.get('talkback') || !ttsAvailable()) return;
    const el = e.target.closest('[title],[aria-label],button,.list-item,.app-icon,.notification,.qs-tile') || e.target;
    const text = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '').trim().split('\n').slice(0, 2).join('. ');
    if (text) speak(text.slice(0, 200)).catch(() => {});
  }, true);

  // ---- power / screen state
  const setScreen = on => {
    sys.screenOn = on;
    screenOff.el.classList.toggle('off', !on);
    if (!on) { shade.close(); recents.close(); if (prefs.get('lock_type') !== 'none') keyguard.show(); keyguard.lockSound(); }
    else screenOff.reset();
    sys.emit('screen', on);
  };
  sys.on('timeout', () => setScreen(false));
  const powerOff = async () => {
    sys.screenOn = false;
    bootLayer.classList.add('showing');
    bootLayer.innerHTML = '';
    const msg = h('div.shutdown', h('div.spinner'), h('div', 'Shutting down…'));
    bootLayer.append(msg);
    await sleep(1800);
    msg.remove();
    sys.tasks.slice().forEach(t => sys.destroy(t));
    bootLayer.append(h('div.powered-off', 'Press the power button to turn on'));
    poweredOff = true;
  };
  const reboot = async () => { await powerOff(); await sleep(600); boot(); };
  let poweredOff = false, powerTimer = null, powerLong = false;
  const powerDown = () => { powerLong = false; powerTimer = setTimeout(() => { powerLong = true; if (!poweredOff && sys.screenOn) globalActions({ powerOff, reboot }); }, 600); };
  const powerUp = () => { clearTimeout(powerTimer); if (powerLong) return; if (poweredOff) { boot(); return; } setScreen(!sys.screenOn); };
  const pw = device.querySelector('.hw-power');
  pw.addEventListener('pointerdown', powerDown); pw.addEventListener('pointerup', powerUp);
  const volKey = dir => { if (!sys.screenOn) return; volume.adjust(dir, sys.mediaPlaying ? 'media' : sys.alarmRinging ? 'alarm' : 'ring'); };
  device.querySelector('.hw-volup').addEventListener('click', () => volKey(1));
  device.querySelector('.hw-voldown').addEventListener('click', () => volKey(-1));

  // ---- keyboard
  window.addEventListener('keydown', e => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    const k = e.key;
    if (e.altKey && (k === 'p' || k === 'P')) { if (!e.repeat) powerDown(); e.preventDefault(); return; }
    if (!sys.screenOn) return;
    if (k === 'Escape') { e.preventDefault(); navbar.children[0].click(); }
    else if ((e.altKey && (k === 'h' || k === 'H')) || (k === 'Home' && !inField)) { e.preventDefault(); navbar.children[1].click(); }
    else if ((e.altKey && (k === 'r' || k === 'R')) || (k === 'End' && !inField)) { e.preventDefault(); navbar.children[2].click(); }
    else if (e.altKey && (k === 'n' || k === 'N')) { e.preventDefault(); if (!keyguard.isShowing()) shade.toggle(); }
    else if (k === 'PageUp') { e.preventDefault(); volKey(1); }
    else if (k === 'PageDown') { e.preventDefault(); volKey(-1); }
    else if (keyguard.isShowing() && (k === 'Enter' || k === ' ') && !inField) keyguard.tryUnlock();
  });
  window.addEventListener('keyup', e => { if (e.altKey || e.key === 'Alt' || e.key === 'p' || e.key === 'P') { if (powerTimer) powerUp(); powerTimer = null; } });

  // ---- service worker (offline PWA), only for the multi-file build
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !document.documentElement.dataset.standalone) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // ---- boot
  async function boot() {
    poweredOff = false;
    bootLayer.innerHTML = '';
    bootLayer.classList.add('showing');
    sys.screenOn = true;
    screenOff.el.classList.remove('off');
    if (!params.has('noboot')) await bootAnimation(bootLayer, 3600);
    keyguard.show();
    if (params.has('unlock')) keyguard.unlock();
    bootLayer.classList.remove('showing');
    chrome();
    screenOff.reset();
    if (!prefs.get('welcomed')) {
      setTimeout(() => nm.notify({
        id: 'welcome', appId: 'settings', smallIcon: 'ic_android', color: '#009688', silent: true,
        title: 'Welcome to Android 5.0', text: 'AOSP 5.0.0_r5, running in your web browser. Tap for details.',
        onClick: () => { prefs.set('welcomed', true); sys.launch('settings', { page: 'about' }); },
      }), 1200);
    }
  }
  startAlarmService();
  boot();
}

main();
