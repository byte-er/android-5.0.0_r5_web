// packages/apps/Settings
import { h, icon, vector, sleep } from '../core/dom.js';
import { App, registerApp, installedApps, appManifest, sys } from '../core/system.js';
import { prefs } from '../core/prefs.js';
import { asset } from '../core/assets.js';
import { db } from '../core/db.js';
import { toolbar, listItem, switchItem, switchEl, subheader, slider, dialog, toast, PageStack, prompt, button } from '../core/ui.js';
import { Ringtone, soundList, click } from '../core/sound.js';
import { speak, ttsAvailable, ttsLanguages, stopSpeaking } from '../core/tts.js';
import { patternView } from '../systemui/keyguard.js';
import { battery } from '../systemui/battery.js';
import { BUILD_PROPS, STRINGS } from '@gen';
import { resetLauncherLayout } from '../launcher/launcher.js';

const S = (k, d) => STRINGS[k] || d;
const LANG_NAMES = { 'en-US': 'English (United States)', 'en-GB': 'English (United Kingdom)', 'de-DE': 'Deutsch (Deutschland)', 'es-ES': 'Español (España)', 'fr-FR': 'Français (France)', 'it-IT': 'Italiano (Italia)' };
const SAMPLES = { 'en-US': 'This is an example of speech synthesis in English.', 'en-GB': 'This is an example of speech synthesis in English.', 'de-DE': 'Dies ist ein Beispiel für Sprachsynthese in Deutsch.', 'es-ES': 'Este es un ejemplo de síntesis de voz en español.', 'fr-FR': 'Voici un échantillon de synthèse vocale en français.', 'it-IT': 'Questo è un esempio di sintesi vocale in italiano.' };
const RATES = [[60, 'Very slow'], [80, 'Slow'], [100, 'Normal'], [150, 'Fast'], [200, 'Faster'], [250, 'Very fast'], [300, 'Fastest']];
const PITCHES = [[50, 'Very low'], [75, 'Low'], [100, 'Normal'], [150, 'High'], [200, 'Very high']];
const TIMEOUTS = [[15000, '15 seconds'], [30000, '30 seconds'], [60000, '1 minute'], [120000, '2 minutes'], [300000, '5 minutes'], [600000, '10 minutes'], [1800000, '30 minutes'], [0, 'Never']];
const bootTime = Date.now();
const battHistory = [];
setInterval(() => battHistory.push({ t: Date.now(), l: battery.level }), 60000);
battHistory.push({ t: Date.now(), l: battery.level });

const settingsIcon = name => {
  const s = h('span.settings-icon');
  const url = asset(`settings/ic_settings_${name}.png`);
  if (url) { s.style.webkitMaskImage = s.style.maskImage = `url(${url})`; }
  return s;
};

function choice(title, options, current, onPick) {
  const idx = options.findIndex(o => o[0] === current);
  dialog({ title, singleChoice: { selected: idx }, items: options.map(o => ({ label: o[1], onClick: () => onPick(o[0]) })), buttons: [{ label: 'Cancel' }] });
}
const labelOf = (options, v) => (options.find(o => o[0] === v) || [, ''])[1];

class Settings extends App {
  onCreate(root, intent) {
    this.stack = new PageStack(root);
    this.devTaps = 0; this.verTaps = 0;
    this.stack.push(this.dashboard(), false);
    if (intent.page) this.open(intent.page, intent);
  }
  onNewIntent(intent) { if (intent.page) { while (this.stack.pop()); this.open(intent.page, intent); } }
  onBack() { stopSpeaking(); return this.stack.pop(); }

  page(title, ...children) {
    const content = h('div.page-content.settings-list', null, ...children);
    const p = h('div', null, toolbar({ title, back: () => this.stack.depth > 1 ? this.stack.pop() : this.finish() }), content);
    p.content = content;
    return p;
  }
  switchBar(pref, onChange) {
    const label = h('span', prefs.get(pref) ? 'On' : 'Off');
    const sw = switchEl(prefs.get(pref), v => { prefs.set(pref, v); label.textContent = v ? 'On' : 'Off'; onChange && onChange(v); });
    const bar = h('div.switch-bar.rip', { onclick: () => sw.click() }, label, sw);
    return bar;
  }
  item(name, title, page, summary) {
    return listItem({ icon: settingsIcon(name), title, summary, onClick: () => this.open(page) });
  }
  open(name, intent = {}) {
    const f = this['p_' + name];
    if (f) this.stack.push(f.call(this, intent));
  }

  dashboard() {
    const sec = (t, ...items) => h('div.dash-section', h('div.dash-title', t), h('div.dash-grid', ...items));
    const tile = (ic, title, page) => h('div.dash-tile.rip', { onclick: () => { click(); this.open(page); } }, settingsIcon(ic), h('div', title));
    const devTile = h('div', { style: { display: 'contents' } });
    const renderDev = () => { devTile.innerHTML = ''; if (prefs.get('dev_enabled')) devTile.append(tile('development', '{ } Developer options', 'developer')); };
    renderDev(); prefs.on('dev_enabled', renderDev);
    return h('div.settings-dash', null,
      toolbar({ title: 'Settings', actions: [{ icon: 'search', label: 'Search', onClick: () => this.search() }] }),
      h('div.page-content', null,
        sec(S('wireless_networks_settings_title', 'Wireless & networks'),
          tile('wireless', S('wifi_settings_title', 'Wi-Fi'), 'wifi'), tile('bluetooth2', S('bluetooth_settings_title', 'Bluetooth'), 'bluetooth'),
          tile('data_usage', S('data_usage_summary_title', 'Data usage'), 'data'), tile('more', 'More', 'more')),
        sec(S('device_section_title', 'Device'),
          tile('display_am', S('display_settings', 'Display'), 'display'), tile('notifications', 'Sound & notification', 'sound'),
          tile('storage', S('storage_settings', 'Storage'), 'storage'), tile('battery', S('power_usage_summary_title', 'Battery'), 'battery'),
          tile('applications', S('applications_settings', 'Apps'), 'apps')),
        sec(S('personal_section_title', 'Personal'),
          tile('location', S('location_settings_title', 'Location'), 'location'), tile('security', S('security_settings_title', 'Security'), 'security'),
          tile('accounts', 'Accounts', 'accounts'), tile('language', S('language_settings', 'Language & input'), 'language'),
          tile('backup', 'Backup & reset', 'backup')),
        sec(S('system_section_title', 'System'),
          tile('date_time', S('date_and_time', 'Date & time'), 'date'), tile('accessibility', S('accessibility_settings', 'Accessibility'), 'accessibility'),
          tile('print', S('printing_settings', 'Printing'), 'printing'), devTile,
          tile('about', 'About phone', 'about'))));
  }
  search() {
    const items = [['Wi-Fi', 'wifi'], ['Bluetooth', 'bluetooth'], ['Display', 'display'], ['Brightness', 'display'], ['Wallpaper', 'display'], ['Sound', 'sound'], ['Ringtone', 'sound'],
      ['Storage', 'storage'], ['Battery', 'battery'], ['Apps', 'apps'], ['Location', 'location'], ['Security', 'security'], ['Screen lock', 'security'], ['Language', 'language'],
      ['Text-to-speech output', 'tts'], ['Date & time', 'date'], ['Accessibility', 'accessibility'], ['TalkBack', 'accessibility'], ['About phone', 'about'], ['Factory data reset', 'backup']];
    const input = h('input.search-field', { placeholder: 'Search…', autofocus: true });
    const results = h('div.settings-list');
    const render = () => { results.innerHTML = ''; const q = input.value.toLowerCase(); items.filter(i => i[0].toLowerCase().includes(q)).forEach(([t, p]) => results.append(listItem({ icon: 'search', title: t, onClick: () => { this.stack.pop(); this.open(p); } }))); };
    input.addEventListener('input', render); render();
    const pg = h('div', null, h('div.toolbar.search-toolbar', h('button.tb-btn.rip.rip-u', { onclick: () => this.stack.pop() }, icon('back')), input), h('div.page-content', results));
    this.stack.push(pg); setTimeout(() => input.focus(), 250);
  }

  // ---------- Wireless
  p_wifi() {
    const list = h('div');
    const render = () => {
      list.innerHTML = '';
      if (!prefs.get('wifi')) { list.append(h('div.empty-msg', 'To see available networks, turn Wi-Fi on.')); return; }
      const c = navigator.connection || {};
      const lvl = !navigator.onLine ? 0 : ({ '4g': 4, '3g': 3, '2g': 2, 'slow-2g': 1 })[c.effectiveType] ?? 4;
      list.append(listItem({ icon: vector(`ic_qs_wifi_full_${lvl}`, 'tint'), title: 'Browser network', summary: navigator.onLine ? 'Connected' : 'No Internet access' }));
      if (c.effectiveType) list.append(listItem({ title: 'Link speed', summary: `${c.downlink ?? '?'} Mbps (${c.effectiveType.toUpperCase()}), RTT ${c.rtt ?? '?'} ms` }));
      list.append(listItem({ title: 'Add network', icon: 'add', onClick: () => prompt({ title: 'Add network', placeholder: 'Network SSID', onOk: v => v && toast(`Couldn't connect to ${v}`) }) }));
    };
    render(); prefs.on('wifi', render);
    return this.page(S('wifi_settings_title', 'Wi-Fi'), this.switchBar('wifi', render), list);
  }
  p_bluetooth() {
    const list = h('div');
    const render = () => {
      list.innerHTML = '';
      if (!prefs.get('bluetooth')) { list.append(h('div.empty-msg', 'When Bluetooth is turned on, your device can communicate with other nearby Bluetooth devices.')); return; }
      list.append(subheader('Available devices'));
      list.append(listItem({ icon: 'search', title: navigator.bluetooth ? 'Pair new device' : 'Web Bluetooth not supported by this browser',
        summary: navigator.bluetooth ? 'Uses the Web Bluetooth API' : null,
        onClick: navigator.bluetooth ? async () => { try { const d = await navigator.bluetooth.requestDevice({ acceptAllDevices: true }); toast(`Found ${d.name || 'device'}`); list.append(listItem({ icon: vector('stat_sys_data_bluetooth', 'tint'), title: d.name || d.id, summary: 'Paired' })); } catch { toast('No device selected'); } } : null }));
    };
    render();
    return this.page(S('bluetooth_settings_title', 'Bluetooth'), this.switchBar('bluetooth', render), list);
  }
  p_data() {
    const entries = performance.getEntriesByType('resource').concat(performance.getEntriesByType('navigation'));
    const bytes = entries.reduce((s, e) => s + (e.transferSize || 0), 0);
    const mb = (bytes / 1048576).toFixed(2);
    const bar = h('div.usage-graph', h('div', { style: { width: Math.min(100, bytes / 1048576 / 20 * 100) + '%' } }));
    return this.page(S('data_usage_summary_title', 'Data usage'),
      switchItem({ title: 'Cellular data', checked: prefs.get('data'), onChange: v => prefs.set('data', v) }),
      h('div.usage-head', h('div.big', mb + ' MB'), h('div', 'used by this browser session')), bar,
      listItem({ title: 'Android System (this page)', summary: mb + ' MB' }));
  }
  p_more() {
    return this.page('Wireless & networks',
      switchItem({ title: 'Airplane mode', checked: prefs.get('airplane'), onChange: v => prefs.set('airplane', v) }),
      switchItem({ title: 'Portable Wi-Fi hotspot', checked: prefs.get('hotspot'), onChange: v => prefs.set('hotspot', v) }),
      listItem({ title: 'VPN', summary: 'Not available in the browser', onClick: () => toast('VPN is not supported') }),
      listItem({ title: 'Cellular networks', summary: prefs.get('data') ? 'Android' : 'Off' }));
  }

  // ---------- Device
  p_display() {
    const bright = listItem({ title: 'Brightness level', onClick: () => {
      const sl = slider(prefs.get('brightness'), v => prefs.set('brightness', v), { min: 0.15, max: 1 });
      dialog({ title: 'Brightness level', view: sl, buttons: [{ label: 'OK' }] });
    } });
    const sleepItem = listItem({ title: 'Sleep', summary: 'After ' + labelOf(TIMEOUTS, prefs.get('screen_off_timeout')) + ' of inactivity',
      onClick: () => choice('Sleep', TIMEOUTS, prefs.get('screen_off_timeout'), v => { prefs.set('screen_off_timeout', v); sleepItem.setSummary(v ? 'After ' + labelOf(TIMEOUTS, v) + ' of inactivity' : 'Never'); }) });
    const FONTS = [[0.85, 'Small'], [1, 'Normal'], [1.15, 'Large'], [1.3, 'Huge']];
    const font = listItem({ title: S('font_size', 'Font size'), summary: labelOf(FONTS, prefs.get('font_scale')), onClick: () => choice('Font size', FONTS, prefs.get('font_scale'), v => { prefs.set('font_scale', v); font.setSummary(labelOf(FONTS, v)); }) });
    return this.page(S('display_settings', 'Display'), bright,
      listItem({ title: 'Wallpaper', onClick: () => sys.openWallpaperPicker && sys.openWallpaperPicker() }),
      sleepItem,
      switchItem({ title: 'Invert colors', checked: prefs.get('invert'), onChange: v => prefs.set('invert', v) }),
      font,
      switchItem({ title: 'When device is rotated', summary: 'Stay in portrait view', checked: prefs.get('rotation_lock'), onChange: v => prefs.set('rotation_lock', v) }),
      switchItem({ title: 'Cast screen', checked: prefs.get('cast'), onChange: v => prefs.set('cast', v) }));
  }
  p_sound() {
    const vol = (title, key, stream) => {
      const sl = slider(prefs.get(key), v => prefs.set(key, v), { onEnd: () => { const kind = stream === 'alarm' ? 'alarms' : stream === 'notification' ? 'notifications' : 'ringtones'; const r = new Ringtone(kind, prefs.get(stream === 'alarm' ? 'alarm_sound' : stream === 'notification' ? 'notification_sound' : 'ringtone'), stream === 'media' ? 'media' : stream); r.play(); setTimeout(() => r.stop(), 1500); } });
      return h('div.vol-item', h('div.li-title', title), sl);
    };
    const pick = (title, kind, key) => {
      const li = listItem({ title, summary: prefs.get(key), onClick: () => {
        let preview = null;
        const names = soundList(kind);
        const sel = Math.max(0, names.indexOf(prefs.get(key)));
        const d = dialog({ title, singleChoice: { selected: sel }, items: names.map(n => ({ label: n, onClick: () => { preview && preview.stop(); prefs.set(key, n); li.setSummary(n); } })), buttons: [{ label: 'Cancel', onClick: () => preview && preview.stop() }], onDismiss: () => preview && preview.stop() });
        // preview on hover/tap like RingtonePickerActivity
        d.box.querySelectorAll('.dlg-item').forEach((it, i) => it.addEventListener('pointerenter', () => { preview && preview.stop(); preview = new Ringtone(kind, names[i], kind === 'alarms' ? 'alarm' : 'ring'); preview.play(); }));
      } });
      return li;
    };
    return this.page('Sound & notification',
      subheader('Sound'),
      vol('Media volume', 'vol_media', 'media'), vol('Alarm volume', 'vol_alarm', 'alarm'), vol('Ring volume', 'vol_ring', 'ring'),
      switchItem({ title: 'Also vibrate for calls', checked: prefs.get('vibrate_calls'), onChange: v => prefs.set('vibrate_calls', v) }),
      listItem({ title: 'Interruptions', summary: { normal: 'Always interrupt', vibrate: 'Priority only', silent: 'Don’t interrupt' }[prefs.get('ringer_mode')], onClick: () => choice('Interruptions', [['normal', 'Always interrupt'], ['vibrate', 'Priority only'], ['silent', 'Don’t interrupt']], prefs.get('ringer_mode'), v => prefs.set('ringer_mode', v)) }),
      pick('Phone ringtone', 'ringtones', 'ringtone'), pick('Default notification ringtone', 'notifications', 'notification_sound'), pick('Default alarm sound', 'alarms', 'alarm_sound'),
      subheader('Other sounds'),
      switchItem({ title: 'Dial pad tones', checked: prefs.get('dial_tones'), onChange: v => prefs.set('dial_tones', v) }),
      switchItem({ title: 'Screen locking sounds', checked: prefs.get('lock_sounds'), onChange: v => prefs.set('lock_sounds', v) }),
      switchItem({ title: 'Touch sounds', checked: prefs.get('touch_sounds'), onChange: v => prefs.set('touch_sounds', v) }),
      subheader('Notification'),
      listItem({ title: 'Send a test notification', onClick: () => import('../core/notifications.js').then(({ nm }) => nm.notify({ appId: 'settings', smallIcon: 'ic_android', title: 'Test notification', text: 'Notifications are working.', color: '#009688', headsUp: true })) }));
  }
  p_storage() {
    const list = h('div');
    (async () => {
      let used = 0, quota = 0;
      try { const e = await navigator.storage.estimate(); used = e.usage || 0; quota = e.quota || 0; } catch {}
      const media = await db.all('media'), recs = await db.all('recordings');
      const gb = b => b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(2) + ' MB';
      list.append(h('div.usage-head', h('div.big', gb(used)), h('div', 'used of ' + gb(quota))),
        h('div.usage-graph', h('div', { style: { width: (quota ? used / quota * 100 : 0) + '%' } })),
        listItem({ title: 'Total space', summary: gb(quota) }), listItem({ title: 'Available', summary: gb(quota - used) }),
        listItem({ title: 'Pictures, videos', summary: media.length + ' items' }), listItem({ title: 'Audio recordings', summary: recs.length + ' items' }),
        listItem({ title: 'Persistent storage', summary: navigator.storage && navigator.storage.persist ? 'Tap to request' : 'Unsupported', onClick: async () => { try { toast((await navigator.storage.persist()) ? 'Storage will persist' : 'Request denied'); } catch {} } }));
    })();
    return this.page(S('storage_settings', 'Storage'), list);
  }
  p_battery() {
    const c = h('canvas.battery-graph', { width: 640, height: 240 });
    const draw = () => {
      const g = c.getContext('2d'); g.clearRect(0, 0, 640, 240);
      g.strokeStyle = '#ddd'; g.lineWidth = 1; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * 60); g.lineTo(640, i * 60); g.stroke(); }
      const pts = battHistory.concat([{ t: Date.now(), l: battery.level }]);
      const t0 = pts[0].t, t1 = Math.max(t0 + 60000, Date.now());
      g.strokeStyle = '#009688'; g.lineWidth = 4; g.beginPath();
      pts.forEach((p, i) => { const x = (p.t - t0) / (t1 - t0) * 640, y = 240 - p.l / 100 * 240; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    };
    setTimeout(draw, 50);
    const up = Math.round((Date.now() - bootTime) / 60000);
    return this.page(S('power_usage_summary_title', 'Battery'),
      h('div.usage-head', h('div.big', battery.level + '%'), h('div', battery.known ? (battery.plugged ? 'Charging' : 'On battery') : 'Battery Status API unavailable; simulated')),
      c, listItem({ title: 'Screen', summary: `On for ${up} min` }), listItem({ title: 'Android OS', summary: 'Since boot' }),
      switchItem({ title: 'Battery saver', checked: prefs.get('battery_saver'), onChange: v => { prefs.set('battery_saver', v); prefs.set('anim_scale', v ? 0 : 1); } }));
  }
  p_apps() {
    const list = installedApps().sort((a, b) => a.label.localeCompare(b.label)).map(m =>
      listItem({ avatar: h('img.li-appicon', { src: asset(`icon/${m.icon}.png`) || '' }), title: m.label, summary: sys.findTask(m.id) ? 'Running' : null, onClick: () => this.open('app', { app: m.id }) }));
    return this.page(S('applications_settings', 'Apps'), ...list);
  }
  p_app({ app }) {
    const m = appManifest(app);
    if (!m) return this.page('App info');
    const stores = m.stores || [];
    return this.page('App info',
      h('div.app-info-head', h('img', { src: asset(`icon/${m.icon}.png`) || '' }), h('div', h('div.li-title', m.label), h('div.li-summary', 'version ' + BUILD_PROPS['ro.build.version.release'] + '-' + BUILD_PROPS['ro.build.id']))),
      h('div.btn-row', button('FORCE STOP', () => { const t = sys.findTask(app); if (t) { sys.destroy(t); toast(`${m.label} stopped`); } else toast('Not running'); }, 'raised'),
        button('CLEAR DATA', async () => { for (const s of stores) await db.clear(s); toast(stores.length ? 'Data cleared' : 'No data'); }, 'raised')),
      listItem({ title: 'Package', summary: m.pkg || 'com.android.' + app }),
      listItem({ title: 'Permissions', summary: (m.permissions || ['No permissions']).join(', ') }));
  }

  // ---------- Personal
  p_location() {
    const info = listItem({ title: 'Current location', summary: 'Tap to request (Geolocation API)', onClick: () => {
      if (!prefs.get('location')) return toast('Location is off');
      navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => info.setSummary(`${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)} (±${Math.round(p.coords.accuracy)} m)`), e => info.setSummary(e.message)) : info.setSummary('Unavailable');
    } });
    return this.page(S('location_settings_title', 'Location'), this.switchBar('location'),
      listItem({ title: 'Mode', summary: 'High accuracy' }), subheader('Recent location requests'), info);
  }
  p_security() {
    const lockItem = listItem({ title: 'Screen lock', summary: { none: 'None', swipe: 'Swipe', pin: 'PIN', pattern: 'Pattern' }[prefs.get('lock_type')], onClick: () => {
      choice('Choose screen lock', [['none', 'None'], ['swipe', 'Swipe'], ['pattern', 'Pattern'], ['pin', 'PIN']], prefs.get('lock_type'), v => {
        const done = () => lockItem.setSummary({ none: 'None', swipe: 'Swipe', pin: 'PIN', pattern: 'Pattern' }[v]);
        if (v === 'pin') this.setupPin(() => { prefs.set('lock_type', 'pin'); done(); });
        else if (v === 'pattern') this.setupPattern(() => { prefs.set('lock_type', 'pattern'); done(); });
        else { prefs.set('lock_type', v); done(); }
      });
    } });
    return this.page(S('security_settings_title', 'Security'), subheader('Screen security'), lockItem,
      listItem({ title: 'Owner info', summary: prefs.get('user_name'), onClick: () => prompt({ title: 'Owner info', value: prefs.get('user_name'), onOk: v => prefs.set('user_name', v || 'Owner') }) }),
      listItem({ title: 'Smart Lock', summary: 'Not available' }), subheader('Passwords'),
      switchItem({ title: 'Make passwords visible', checked: true, onChange: () => {} }),
      subheader('Device administration'), listItem({ title: 'Unknown sources', summary: 'Install apps from unknown sources' }),
      subheader('Advanced'), listItem({ title: 'Screen pinning', summary: 'Off' }));
  }
  setupPin(done) {
    prompt({ title: 'Choose your PIN', type: 'password', placeholder: 'At least 4 digits', ok: 'Continue', onOk: a => {
      if (!/^\d{4,16}$/.test(a)) return toast('PIN must be 4-16 digits');
      setTimeout(() => prompt({ title: 'Confirm your PIN', type: 'password', ok: 'OK', onOk: b => { if (a === b) { prefs.set('lock_pin', a); toast('PIN set'); done(); } else toast("PINs don't match"); } }), 200);
    } });
  }
  setupPattern(done) {
    let first = null;
    const msg = h('div.pattern-msg', 'Draw an unlock pattern');
    const pv = patternView((seq, n) => {
      if (n < 4) { msg.textContent = 'Connect at least 4 dots. Try again.'; pv.flash('err'); setTimeout(() => pv.clear(), 800); return; }
      if (!first) { first = seq; msg.textContent = 'Draw pattern again to confirm'; pv.flash('ok'); setTimeout(() => pv.clear(), 500); return; }
      if (seq === first) { prefs.set('lock_pattern', seq); d.close(); toast('Pattern set'); done(); }
      else { msg.textContent = 'Try again'; first = null; pv.flash('err'); setTimeout(() => pv.clear(), 800); }
    }, { size: 240 });
    const d = dialog({ title: 'Choose your pattern', view: h('div.pattern-setup', msg, pv), buttons: [{ label: 'Cancel' }] });
  }
  p_accounts() { return this.page('Accounts', listItem({ icon: 'add', title: 'Add account', onClick: () => toast('No account types available') })); }
  p_language() {
    const voice = ttsAvailable() ? 'Pico TTS' : 'Not available';
    return this.page(S('language_settings', 'Language & input'),
      listItem({ title: 'Language', summary: LANG_NAMES[navigator.language] || navigator.language }),
      listItem({ title: 'Spell checker', summary: 'Android Spell Checker (AOSP)' }),
      subheader('Keyboard & input methods'),
      listItem({ title: 'Current Keyboard', summary: 'Browser keyboard' }),
      subheader('Speech'),
      listItem({ title: S('tts_settings_title', 'Text-to-speech output'), summary: voice, onClick: () => this.open('tts') }),
      subheader('Mouse/trackpad'), listItem({ title: 'Pointer speed' }));
  }
  p_tts() {
    if (!ttsAvailable()) return this.page('Text-to-speech output', h('div.empty-msg', 'The Pico TTS engine (svoxpico.wasm) is not included in this build.'));
    const status = h('div.tts-status', 'SVOX Pico, compiled from external/svox/pico to WebAssembly.');
    const langItem = listItem({ title: 'Language', summary: LANG_NAMES[prefs.get('tts_lang')], onClick: () => choice('Language', ttsLanguages().map(l => [l, LANG_NAMES[l] || l]), prefs.get('tts_lang'), v => { prefs.set('tts_lang', v); langItem.setSummary(LANG_NAMES[v]); }) });
    const rate = listItem({ title: S('tts_default_rate_title', 'Speech rate'), summary: labelOf(RATES, prefs.get('tts_rate')), onClick: () => choice('Speech rate', RATES, prefs.get('tts_rate'), v => { prefs.set('tts_rate', v); rate.setSummary(labelOf(RATES, v)); }) });
    const pitch = listItem({ title: S('tts_default_pitch_title', 'Pitch'), summary: labelOf(PITCHES, prefs.get('tts_pitch')), onClick: () => choice('Pitch', PITCHES, prefs.get('tts_pitch'), v => { prefs.set('tts_pitch', v); pitch.setSummary(labelOf(PITCHES, v)); }) });
    const run = async text => {
      status.textContent = 'Synthesizing…';
      try { const r = await speak(text); status.textContent = `Synthesized ${r.seconds.toFixed(1)} s of 16 kHz audio in ${Math.round(r.synthMs)} ms (WebAssembly).`; }
      catch (e) { status.textContent = 'Error: ' + e.message; }
    };
    const box = h('textarea.text-field.tts-box', { rows: 3, placeholder: 'Type something to speak…' });
    return this.page(S('tts_settings_title', 'Text-to-speech output'),
      subheader(S('tts_engine_preference_section_title', 'Preferred engine')),
      listItem({ icon: vector('ic_android', 'tint'), title: 'Pico TTS', summary: 'external/svox/pico → svoxpico.wasm', widget: h('span.radio.on', h('span.rd-dot')) }),
      langItem, subheader('General'), rate, pitch,
      listItem({ title: S('tts_play_example_title', 'Listen to an example'), summary: 'Play a short demonstration of speech synthesis', onClick: () => run(SAMPLES[prefs.get('tts_lang')] || SAMPLES['en-US']) }),
      h('div.tts-try', box, button('SPEAK', () => box.value.trim() && run(box.value.trim()), 'raised')), status,
      listItem({ title: 'Default language status', summary: `${LANG_NAMES[prefs.get('tts_lang')]} is fully supported` }));
  }
  p_backup() {
    return this.page('Backup & reset',
      switchItem({ title: 'Back up my data', summary: 'Not available in the browser', checked: false, onChange: () => toast('Backup is not available') }),
      listItem({ title: 'Network settings reset', summary: 'Resets Wi-Fi, cellular & Bluetooth', onClick: () => { prefs.set('wifi', true); prefs.set('bluetooth', false); prefs.set('data', true); prefs.set('airplane', false); toast('Network settings have been reset'); } }),
      listItem({ title: 'Factory data reset', summary: 'Erases all data on device', onClick: () => dialog({ title: 'Reset?', message: 'Erase all your personal information and downloaded apps? You can’t reverse this action!', buttons: [{ label: 'Cancel' }, { label: 'Erase everything', onClick: () => this.factoryReset() }] }) }));
  }
  async factoryReset() {
    toast('Erasing…');
    try { localStorage.clear(); } catch {}
    try { await new Promise(r => { const q = indexedDB.deleteDatabase('android5web'); q.onsuccess = q.onerror = q.onblocked = r; }); } catch {}
    await sleep(600);
    location.reload();
  }

  // ---------- System
  p_date() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return this.page(S('date_and_time', 'Date & time'),
      switchItem({ title: 'Automatic date & time', summary: 'Use network-provided time', checked: true, onChange: () => toast('Time comes from your browser') }),
      switchItem({ title: 'Automatic time zone', summary: 'Use network-provided time zone', checked: true, onChange: () => {} }),
      listItem({ title: 'Set date', summary: new Date().toLocaleDateString() }), listItem({ title: 'Set time', summary: new Date().toLocaleTimeString() }),
      listItem({ title: 'Select time zone', summary: tz }),
      switchItem({ title: 'Use 24-hour format', summary: '13:00', checked: prefs.get('time_24'), onChange: v => prefs.set('time_24', v) }));
  }
  p_accessibility() {
    return this.page(S('accessibility_settings', 'Accessibility'), subheader('Services'),
      switchItem({ title: 'TalkBack', summary: ttsAvailable() ? 'Speaks touched items aloud with Pico TTS' : 'Requires Pico TTS', checked: prefs.get('talkback'), onChange: v => { prefs.set('talkback', v); if (v && ttsAvailable()) speak('TalkBack on'); } }),
      subheader('System'),
      switchItem({ title: 'Large text', checked: prefs.get('large_text'), onChange: v => prefs.set('large_text', v) }),
      switchItem({ title: 'High contrast text', checked: prefs.get('high_contrast'), onChange: v => { prefs.set('high_contrast', v); document.getElementById('screen').classList.toggle('high-contrast', v); } }),
      switchItem({ title: 'Power button ends call', checked: false, onChange: () => {} }),
      listItem({ title: 'Text-to-speech output', onClick: () => this.open('tts') }),
      subheader('Display'),
      switchItem({ title: 'Color inversion', checked: prefs.get('invert'), onChange: v => prefs.set('invert', v) }));
  }
  p_printing() { return this.page(S('printing_settings', 'Printing'), subheader('Print services'), listItem({ title: 'Browser print', summary: 'Print the current screen with window.print()', onClick: () => window.print() })); }
  p_developer() {
    const SCALES = [[0, 'Animation off'], [0.5, 'Animation scale .5x'], [1, 'Animation scale 1x'], [1.5, 'Animation scale 1.5x'], [2, 'Animation scale 2x'], [5, 'Animation scale 5x'], [10, 'Animation scale 10x']];
    const anim = listItem({ title: 'Window animation scale', summary: labelOf(SCALES, prefs.get('anim_scale')), onClick: () => choice('Window animation scale', SCALES, prefs.get('anim_scale'), v => { prefs.set('anim_scale', v); anim.setSummary(labelOf(SCALES, v)); }) });
    return this.page('Developer options', this.switchBar('dev_enabled', v => { if (!v) this.stack.pop(); }),
      switchItem({ title: 'Stay awake', summary: 'Screen will never sleep', checked: !!sys.keepScreenOn, onChange: v => { sys.keepScreenOn = v; } }),
      subheader('Input'), switchItem({ title: 'Show touches', summary: 'Show visual feedback for touches', checked: prefs.get('show_touches'), onChange: v => prefs.set('show_touches', v) }),
      subheader('Drawing'), switchItem({ title: 'Show layout bounds', summary: 'Show clip bounds, margins, etc.', checked: prefs.get('show_bounds'), onChange: v => prefs.set('show_bounds', v) }), anim,
      subheader('Apps'), listItem({ title: 'Reset home screen layout', onClick: () => { resetLauncherLayout(); toast('Home screen will reset on reboot'); } }),
      listItem({ title: 'Running services', summary: `${sys.tasks.length} task(s) running`, onClick: () => this.open('apps') }));
  }
  p_about() {
    const p = BUILD_PROPS;
    const ver = listItem({ title: 'Android version', summary: p['ro.build.version.release'], onClick: () => {
      const now = Date.now();
      this.verTaps = now - (this.lastVerTap || 0) < 600 ? this.verTaps + 1 : 1; this.lastVerTap = now;
      if (this.verTaps >= 3) { this.verTaps = 0; sys.launch('platlogo'); }
    } });
    const build = listItem({ title: S('build_number', 'Build number'), summary: p['ro.build.display.id'], onClick: () => {
      if (prefs.get('dev_enabled')) return toast('No need, you are already a developer.');
      this.devTaps++;
      if (this.devTaps >= 7) { prefs.set('dev_enabled', true); toast('You are now a developer!'); }
      else if (this.devTaps >= 3) toast(`You are now ${7 - this.devTaps} steps away from being a developer.`);
    } });
    const wasm = typeof WebAssembly === 'object';
    return this.page('About phone',
      listItem({ title: 'System updates', onClick: () => toast('Your system is up to date') }),
      listItem({ title: 'Status', summary: 'Battery, network and other information', onClick: () => this.open('status') }),
      listItem({ title: 'Legal information', onClick: () => this.open('legal') }),
      listItem({ title: S('model_number', 'Model number'), summary: p['ro.product.model'] }),
      ver,
      listItem({ title: S('baseband_version', 'Baseband version'), summary: 'Unknown' }),
      listItem({ title: S('kernel_version', 'Kernel version'), summary: navigator.userAgent }),
      build,
      listItem({ title: 'Source', summary: `${p['ro.source.tag']} (git ${p['ro.web.git_revision']})` }),
      listItem({ title: 'Runtime', summary: `JavaScript + ${wasm ? 'WebAssembly' : 'no WebAssembly'}, ${navigator.hardwareConcurrency || '?'} CPU threads` }));
  }
  p_status() {
    const up = () => { const s = Math.floor((Date.now() - bootTime) / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
    const upItem = listItem({ title: 'Up time', summary: up() });
    const timer = setInterval(() => upItem.setSummary(up()), 1000);
    const pg = this.page('Status',
      listItem({ title: 'Battery status', summary: battery.plugged ? 'Charging' : 'Discharging' }), listItem({ title: 'Battery level', summary: battery.level + '%' }),
      listItem({ title: 'Network', summary: navigator.onLine ? 'Connected' : 'Disconnected' }),
      listItem({ title: 'Screen', summary: `${screen.width}×${screen.height} @ ${window.devicePixelRatio}x` }),
      listItem({ title: 'Language', summary: navigator.language }), upItem);
    pg.onHide = () => clearInterval(timer);
    return pg;
  }
  p_legal() {
    return this.page('Legal information', h('div.legal', 'Android 5.0 for the web is built from the Android Open Source Project (android-5.0.0_r5).\n\n' +
      'Copyright (C) 2005-2014 The Android Open Source Project. Licensed under the Apache License, Version 2.0.\n\n' +
      'Includes: Roboto and Droid fonts (Apache 2.0); SVOX Pico TTS (Apache 2.0); Material sound set; SystemUI VectorDrawables; Launcher3, Settings, Calculator, DeskClock and other application resources from AOSP.'));
  }
}

registerApp({ id: 'settings', label: 'Settings', icon: 'settings', color: '#263238', colorDark: '#21272b', accent: '#009688', pkg: 'com.android.settings' }, Settings);
