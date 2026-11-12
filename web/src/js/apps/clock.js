// packages/apps/DeskClock (Lollipop): alarms, world clock, timer, stopwatch.
import { h, icon, fmtTime, fmtDate, DAYS, clamp } from '../core/dom.js';
import { App, registerApp, sys } from '../core/system.js';
import { prefs } from '../core/prefs.js';
import { asset } from '../core/assets.js';
import { nm } from '../core/notifications.js';
import { Ringtone, click, vibrate } from '../core/sound.js';
import { tabs, fab, switchEl, dialog, toast, button, prompt } from '../core/ui.js';

// Utils.BACKGROUND_SPECTRUM from DeskClock
const SPECTRUM = ['#212121', '#27232e', '#2d253a', '#332847', '#382a53', '#3e2c5f', '#442e6c', '#393a7a', '#2e4687', '#235395', '#185fa2',
  '#0d6baf', '#0277bd', '#0d6cb1', '#1861a6', '#23569b', '#2d4a8f', '#383f84', '#433478', '#3d3169', '#382e5b', '#322b4d', '#2c273e', '#272430'];
const hourColor = () => SPECTRUM[new Date().getHours()];

// ------------------------------------------------------------------ alarm model + service
const KEY = 'android5web.alarms', CITIES = 'android5web.cities';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const alarms = { list: load(KEY, [{ id: 1, hour: 8, minute: 30, enabled: false, days: [1, 2, 3, 4, 5], label: '' }, { id: 2, hour: 9, minute: 0, enabled: false, days: [0, 6], label: '' }]), listeners: [] };
function saveAlarms() { save(KEY, alarms.list); alarms.listeners.forEach(f => f()); updateNextAlarm(); }
function nextFire(a, from = new Date()) {
  for (let d = 0; d < 8; d++) {
    const t = new Date(from); t.setDate(t.getDate() + d); t.setHours(a.hour, a.minute, 0, 0);
    if (t <= from) continue;
    if (!a.days.length || a.days.includes(t.getDay())) return t;
  }
  return null;
}
function updateNextAlarm() {
  const next = alarms.list.filter(a => a.enabled).map(a => nextFire(a)).filter(Boolean).sort((a, b) => a - b)[0];
  prefs.set('next_alarm', next ? `${DAYS[next.getDay()].slice(0, 3)} ${fmtTime(next, prefs.get('time_24'))}${prefs.get('time_24') ? '' : (next.getHours() < 12 ? ' AM' : ' PM')}` : '');
}
let ringing = null;
export function startAlarmService() {
  updateNextAlarm();
  let lastMinute = -1;
  setInterval(() => {
    const now = new Date();
    const m = now.getHours() * 60 + now.getMinutes();
    if (m === lastMinute) return;
    lastMinute = m;
    for (const a of alarms.list) {
      if (!a.enabled || a.hour !== now.getHours() || a.minute !== now.getMinutes()) continue;
      if (a.days.length && !a.days.includes(now.getDay())) continue;
      if (!a.days.length) { a.enabled = false; saveAlarms(); }
      fireAlarm(a);
    }
    if (snoozeUntil && Date.now() >= snoozeUntil) { const a = snoozeAlarm; snoozeUntil = 0; fireAlarm(a); }
  }, 1000);
}
let snoozeUntil = 0, snoozeAlarm = null;
function fireAlarm(a) {
  if (ringing) return;
  ringing = new Ringtone('alarms', prefs.get('alarm_sound'), 'alarm', true);
  ringing.play();
  sys.alarmRinging = true;
  vibrate([500, 500, 500, 500, 500]);
  nm.notify({ id: 'alarm-ring', appId: 'clock', smallIcon: 'stat_sys_alarm', ongoing: true, silent: true, title: 'Alarm', text: fmtTime(new Date(), prefs.get('time_24')) + (a.label ? ' - ' + a.label : ''), color: '#0277bd',
    actions: [{ label: 'Snooze', onClick: () => stopAlarm(a, true) }, { label: 'Dismiss', onClick: () => stopAlarm(a) }], onClick: () => showAlarmScreen(a) });
  showAlarmScreen(a);
}
function stopAlarm(a, snooze) {
  if (ringing) { ringing.stop(); ringing = null; }
  sys.alarmRinging = false;
  nm.cancel('alarm-ring');
  document.querySelector('.alarm-activity')?.remove();
  if (snooze) {
    snoozeUntil = Date.now() + 10 * 60000; snoozeAlarm = a;
    nm.notify({ id: 'alarm-snooze', appId: 'clock', smallIcon: 'stat_sys_alarm', silent: true, title: 'Snoozing', text: `Alarm set for ${fmtTime(new Date(snoozeUntil), prefs.get('time_24'))}`, color: '#0277bd',
      actions: [{ label: 'Dismiss', onClick: () => { snoozeUntil = 0; nm.cancel('alarm-snooze'); } }] });
    toast('Alarm snoozed for 10 minutes');
  }
}
function showAlarmScreen(a) {
  const screen = document.getElementById('screen');
  if (!screen || screen.querySelector('.alarm-activity')) return;
  const el = h('div.alarm-activity', { style: { background: hourColor() } },
    h('div.aa-time', fmtTime(new Date(), prefs.get('time_24'))), h('div.aa-label', a.label || 'Alarm'),
    h('div.aa-actions',
      h('button.aa-btn.rip.rip-u', { onclick: () => stopAlarm(a, true) }, icon('history'), h('span', 'Snooze')),
      h('div.aa-pulse', icon('alarm')),
      h('button.aa-btn.rip.rip-u', { onclick: () => stopAlarm(a) }, icon('close'), h('span', 'Dismiss'))));
  screen.append(el);
}

// ------------------------------------------------------------------ time picker (Lollipop radial TimePicker)
export function timePicker({ hour, minute, onSet }) {
  let is24 = prefs.get('time_24'), mode = 'hour', hh = hour, mm = minute;
  const hEl = h('span.tp-h.on'), mEl = h('span.tp-m'), am = h('span.tp-ampm', 'AM'), pm = h('span.tp-ampm', 'PM');
  const head = h('div.tp-header', hEl, ':', mEl, is24 ? null : h('div.tp-ampms', am, pm));
  const dial = h('div.tp-dial');
  const hand = h('div.tp-hand'); dial.append(hand);
  const render = () => {
    hEl.textContent = is24 ? String(hh).padStart(2, '0') : String(hh % 12 || 12);
    mEl.textContent = String(mm).padStart(2, '0');
    hEl.classList.toggle('on', mode === 'hour'); mEl.classList.toggle('on', mode === 'minute');
    am.classList.toggle('on', hh < 12); pm.classList.toggle('on', hh >= 12);
    dial.querySelectorAll('.tp-num').forEach(n => n.remove());
    const vals = mode === 'hour' ? (is24 ? [...Array(24).keys()] : [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) : [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
    vals.forEach((v, i) => {
      const inner = is24 && mode === 'hour' && (v === 0 || v > 12);
      const idx = mode === 'hour' ? v % 12 : i;
      const r = inner ? 32 : 42, ang = idx / 12 * 2 * Math.PI;
      const sel = mode === 'hour' ? (is24 ? v === hh : v % 12 === hh % 12) : v === mm;
      dial.append(h('div.tp-num' + (sel ? '.sel' : '') + (inner ? '.inner' : ''), { style: { left: 50 + Math.sin(ang) * r + '%', top: 50 - Math.cos(ang) * r + '%' } }, mode === 'minute' ? String(v).padStart(2, '0') : String(v)));
    });
    const cur = mode === 'hour' ? (hh % 12) / 12 : mm / 60;
    const inner = is24 && mode === 'hour' && (hh === 0 || hh > 12);
    hand.style.transform = `rotate(${cur * 360}deg)`; hand.style.height = (inner ? 32 : 42) + '%';
  };
  const pick = (e, up) => {
    const r = dial.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
    let ang = Math.atan2(x, -y); if (ang < 0) ang += 2 * Math.PI;
    if (mode === 'hour') {
      let v = Math.round(ang / (2 * Math.PI) * 12) % 12;
      if (is24) { const inner = Math.hypot(x, y) < r.width * 0.37; hh = inner ? (v === 0 ? 0 : v + 12) : (v === 0 ? 12 : v); }
      else hh = (hh >= 12 ? 12 : 0) + v;
      if (up) { mode = 'minute'; }
    } else mm = Math.round(ang / (2 * Math.PI) * 60) % 60;
    render();
  };
  dial.addEventListener('pointerdown', e => { dial.setPointerCapture(e.pointerId); pick(e); const mv = ev => pick(ev); dial.addEventListener('pointermove', mv); dial.addEventListener('pointerup', ev => { dial.removeEventListener('pointermove', mv); pick(ev, true); }, { once: true }); });
  hEl.onclick = () => { mode = 'hour'; render(); }; mEl.onclick = () => { mode = 'minute'; render(); };
  am.onclick = () => { if (hh >= 12) hh -= 12; render(); }; pm.onclick = () => { if (hh < 12) hh += 12; render(); };
  render();
  dialog({ cls: 'time-picker', view: h('div', head, dial), buttons: [{ label: 'Cancel' }, { label: 'OK', onClick: () => onSet(hh, mm) }] });
}

// ------------------------------------------------------------------ the app
class DeskClock extends App {
  onCreate(root, intent) {
    this.root = root;
    this.pages = [this.alarmPage(), this.clockPage(), this.timerPage(), this.stopwatchPage()];
    const iconsEls = ['alarm', 'clock', 'timer', 'stopwatch'].map(n => h('img.tab-icon', { src: asset(`clock/ic_tab_${n}.png`) || '', alt: n }));
    this.tabBar = tabs(['Alarm', 'Clock', 'Timer', 'Stopwatch'], i => this.show(i), { icons: iconsEls });
    this.fab = fab('add', () => this.onFab());
    this.body = h('div.dc-body', null, ...this.pages);
    this.el = h('div.deskclock', null, h('div.dc-top', this.tabBar), this.body, this.fab);
    root.append(this.el);
    this.applyColor();
    this.colorTimer = setInterval(() => this.applyColor(), 60000);
    this.show(intent.tab ?? 1);
  }
  onNewIntent(intent) { if (intent.tab != null) this.show(intent.tab); }
  applyColor() { const c = hourColor(); this.el.style.background = c; this.setStatusBarColor(c); }
  onDestroy() { clearInterval(this.colorTimer); clearInterval(this.clockTimer); cancelAnimationFrame(this.swRaf); clearInterval(this.timerTick); }
  show(i) {
    this.tab = i;
    this.tabBar.select(i, true);
    this.pages.forEach((p, j) => { p.hidden = j !== i; });
    this.pages[i].onShow && this.pages[i].onShow();
    this.updateFab();
  }
  updateFab() {
    const set = (ic, vis = true) => { this.fab.hidden = !vis; this.fab.innerHTML = ''; this.fab.append(icon(ic)); };
    if (this.tab === 0) set('add');
    else if (this.tab === 1) set('globe');
    else if (this.tab === 2) set(this.timer.running ? 'pause' : 'play', this.timer.running || this.timer.remaining > 0 || this.timer.entry.length > 0);
    else set(this.sw.running ? 'pause' : 'play');
  }
  onFab() {
    if (this.tab === 0) timePicker({ hour: 7, minute: 0, onSet: (hh, mm) => { const a = { id: Date.now(), hour: hh, minute: mm, enabled: true, days: [], label: '' }; alarms.list.push(a); saveAlarms(); this.renderAlarms(); this.alarmSetToast(a); } });
    else if (this.tab === 1) this.addCity();
    else if (this.tab === 2) this.timerToggle();
    else this.swToggle();
  }
  alarmSetToast(a) {
    const t = nextFire(a); if (!t) return;
    const mins = Math.round((t - Date.now()) / 60000), d = Math.floor(mins / 1440), hr = Math.floor(mins % 1440 / 60), m = mins % 60;
    toast('Alarm set for ' + [d && `${d} day${d > 1 ? 's' : ''}`, hr && `${hr} hour${hr > 1 ? 's' : ''}`, `${m} minute${m !== 1 ? 's' : ''}`].filter(Boolean).join(', ') + ' from now.');
  }

  // ---------------- Alarms
  alarmPage() {
    this.alarmList = h('div.alarm-list');
    const p = h('div.dc-page', null, this.alarmList);
    p.onShow = () => this.renderAlarms();
    return p;
  }
  renderAlarms() {
    this.alarmList.innerHTML = '';
    const is24 = prefs.get('time_24');
    alarms.list.sort((a, b) => a.hour * 60 + a.minute - b.hour * 60 - b.minute).forEach(a => {
      const d = new Date(); d.setHours(a.hour, a.minute);
      const days = h('div.alarm-days', null, [0, 1, 2, 3, 4, 5, 6].map(i => h('button.day.rip.rip-u' + (a.days.includes(i) ? '.on' : ''), { onclick: () => { a.days = a.days.includes(i) ? a.days.filter(x => x !== i) : [...a.days, i]; saveAlarms(); this.renderAlarms(); } }, DAYS[i][0])));
      const card = h('div.alarm-card' + (a.enabled ? '.on' : ''),
        h('div.alarm-row',
          h('div.alarm-time.rip', { onclick: () => timePicker({ hour: a.hour, minute: a.minute, onSet: (hh, mm) => { a.hour = hh; a.minute = mm; a.enabled = true; saveAlarms(); this.renderAlarms(); this.alarmSetToast(a); } }) },
            fmtTime(d, is24), is24 ? null : h('span.ampm', a.hour < 12 ? 'AM' : 'PM')),
          switchEl(a.enabled, v => { a.enabled = v; saveAlarms(); card.classList.toggle('on', v); if (v) this.alarmSetToast(a); })),
        h('div.alarm-sub', a.days.length ? (a.days.length === 7 ? 'Every day' : a.days.slice().sort().map(i => DAYS[i].slice(0, 3)).join(', ')) : (nextFire(a) && nextFire(a).getDate() === new Date().getDate() ? 'Today' : 'Tomorrow')),
        days,
        h('div.alarm-row2',
          h('button.alarm-chip.rip', { onclick: () => prompt({ title: 'Label', value: a.label, onOk: v2 => { a.label = v2; saveAlarms(); this.renderAlarms(); } }) }, a.label || 'Label'),
          h('div.alarm-chip', prefs.get('alarm_sound')),
          h('button.tb-btn.rip.rip-u', { title: 'Delete', onclick: () => { alarms.list = alarms.list.filter(x => x !== a); saveAlarms(); this.renderAlarms(); toast('Alarm deleted'); } }, icon('delete'))));
      this.alarmList.append(card);
    });
    if (!alarms.list.length) this.alarmList.append(h('div.dc-empty', icon('alarm'), 'No Alarms'));
  }

  // ---------------- Clock + world clock
  clockPage() {
    const t = h('div.dc-time'), ap = h('span.dc-ampm'), d = h('div.dc-date');
    this.cityList = h('div.city-list');
    const tick = () => {
      const now = new Date();
      t.firstChild ? t.firstChild.textContent = fmtTime(now, prefs.get('time_24')) : t.append(document.createTextNode(fmtTime(now, prefs.get('time_24'))));
      ap.textContent = prefs.get('time_24') ? '' : (now.getHours() < 12 ? 'AM' : 'PM');
      d.textContent = fmtDate(now).toUpperCase() + (prefs.get('next_alarm') ? '   ⏰ ' + prefs.get('next_alarm') : '');
      this.renderCities();
    };
    t.append(document.createTextNode(''), ap);
    tick(); this.clockTimer = setInterval(tick, 1000);
    return h('div.dc-page.dc-clock', null, h('div.dc-main', t, d), this.cityList);
  }
  renderCities() {
    const cities = load(CITIES, ['America/New_York', 'Europe/London', 'Asia/Tokyo']);
    this.cityList.innerHTML = '';
    for (const tz of cities) {
      let time = '', name = tz.split('/').pop().replace(/_/g, ' ');
      try { time = new Intl.DateTimeFormat([], { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: !prefs.get('time_24') }).format(new Date()); } catch { continue; }
      const el = h('div.city', h('div.city-time', time), h('div.city-name', name.toUpperCase()));
      el.addEventListener('contextmenu', e => { e.preventDefault(); save(CITIES, cities.filter(c => c !== tz)); this.renderCities(); });
      this.cityList.append(el);
    }
  }
  addCity() {
    let zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = ['America/Los_Angeles', 'America/Chicago', 'America/New_York', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland']; }
    const cities = load(CITIES, ['America/New_York', 'Europe/London', 'Asia/Tokyo']);
    const input = h('input.text-field', { placeholder: 'Search city' });
    const list = h('div.city-picker');
    const render = () => {
      list.innerHTML = '';
      zones.filter(z => z.toLowerCase().replace(/_/g, ' ').includes(input.value.toLowerCase())).slice(0, 60).forEach(z => {
        list.append(h('div.dlg-item.rip', { onclick: () => { if (!cities.includes(z)) cities.push(z); save(CITIES, cities); this.renderCities(); d.close(); } }, z.split('/').pop().replace(/_/g, ' '), h('small', '  ' + z)));
      });
    };
    input.addEventListener('input', render); render();
    const d = dialog({ title: 'Cities', view: h('div', input, list), buttons: [{ label: 'Cancel' }] });
  }

  // ---------------- Timer
  timerPage() {
    this.timer = { entry: '', remaining: 0, total: 0, running: false, end: 0 };
    this.tDisplay = h('div.timer-display');
    this.tCircle = h('canvas.timer-circle', { width: 560, height: 560 });
    const key = d => h('button.timer-key.rip.rip-u', { onclick: () => { click(); if (this.timer.entry.length < 6 && !(d === '0' && !this.timer.entry)) this.timer.entry += d; this.renderTimer(); this.updateFab(); } }, d);
    this.tPad = h('div.timer-pad', null, ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key), h('span'), key('0'),
      h('button.timer-key.rip.rip-u', { onclick: () => { this.timer.entry = this.timer.entry.slice(0, -1); this.renderTimer(); this.updateFab(); } }, icon('backspace')));
    this.tActions = h('div.timer-actions', null, button('DELETE', () => this.timerReset()), button('+1:00', () => { this.timer.end += 60000; this.timer.total += 60000; this.timer.remaining += 60000; this.renderTimer(); }));
    const p = h('div.dc-page.dc-timer', null, h('div.timer-face', this.tCircle, this.tDisplay), this.tPad, this.tActions);
    this.renderTimer();
    return p;
  }
  entryMs() { const e = this.timer.entry.padStart(6, '0'); return ((+e.slice(0, 2)) * 3600 + (+e.slice(2, 4)) * 60 + (+e.slice(4, 6))) * 1000; }
  renderTimer() {
    const t = this.timer;
    const active = t.running || t.remaining > 0;
    this.tPad.hidden = active; this.tActions.hidden = !active; this.tCircle.hidden = !active;
    if (!active) { const e = t.entry.padStart(6, '0'); this.tDisplay.innerHTML = `<span class="${t.entry.length > 4 ? 'set' : ''}">${e.slice(0, 2)}h</span> <span class="${t.entry.length > 2 ? 'set' : ''}">${e.slice(2, 4)}m</span> <span class="${t.entry.length ? 'set' : ''}">${e.slice(4, 6)}s</span>`; return; }
    const rem = t.running ? Math.max(0, t.end - Date.now()) : t.remaining;
    const s = Math.ceil(rem / 1000);
    this.tDisplay.textContent = (s >= 3600 ? Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') : Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0');
    const g = this.tCircle.getContext('2d'); g.clearRect(0, 0, 560, 560); g.lineWidth = 8;
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(280, 280, 250, 0, 7); g.stroke();
    g.strokeStyle = '#fff'; g.beginPath(); g.arc(280, 280, 250, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * (rem / t.total)); g.stroke();
  }
  timerToggle() {
    const t = this.timer;
    if (t.running) { t.remaining = t.end - Date.now(); t.running = false; clearInterval(this.timerTick); }
    else {
      if (!t.remaining) { t.total = this.entryMs(); t.remaining = t.total; if (!t.total) return; }
      t.end = Date.now() + t.remaining; t.running = true;
      clearInterval(this.timerTick);
      this.timerTick = setInterval(() => {
        this.renderTimer();
        if (Date.now() >= t.end) { clearInterval(this.timerTick); t.running = false; t.remaining = 0; t.entry = ''; this.timesUp(); this.renderTimer(); this.updateFab(); }
      }, 100);
    }
    this.renderTimer(); this.updateFab();
  }
  timerReset() { clearInterval(this.timerTick); Object.assign(this.timer, { entry: '', remaining: 0, running: false }); this.renderTimer(); this.updateFab(); }
  timesUp() {
    const r = new Ringtone('alarms', 'Timer', 'alarm', true); r.play(); vibrate([300, 200, 300]);
    nm.notify({ id: 'timer', appId: 'clock', smallIcon: 'mdi:timer', title: 'Time’s up', text: 'Timer', color: '#0277bd', ongoing: true, silent: true, headsUp: true, headsUpMs: 30000,
      actions: [{ label: 'Stop', onClick: () => { r.stop(); nm.cancel('timer'); } }], onClick: () => { r.stop(); nm.cancel('timer'); sys.launch('clock', { tab: 2 }); } });
    setTimeout(() => r.stop(), 60000);
  }

  // ---------------- Stopwatch
  stopwatchPage() {
    this.sw = { running: false, start: 0, acc: 0, laps: [] };
    this.swDisplay = h('div.sw-display');
    this.swCanvas = h('canvas.timer-circle', { width: 560, height: 560 });
    this.swLaps = h('div.sw-laps');
    this.swActions = h('div.timer-actions', null, button('RESET', () => { Object.assign(this.sw, { running: false, acc: 0, laps: [] }); this.renderSw(); this.updateFab(); }), button('LAP', () => { if (this.sw.running) { this.sw.laps.unshift(this.swElapsed()); this.renderSw(); } }));
    const p = h('div.dc-page.dc-stopwatch', null, h('div.timer-face', this.swCanvas, this.swDisplay), this.swActions, this.swLaps);
    p.onShow = () => this.renderSw();
    return p;
  }
  swElapsed() { return this.sw.acc + (this.sw.running ? performance.now() - this.sw.start : 0); }
  swToggle() {
    const s = this.sw;
    if (s.running) { s.acc += performance.now() - s.start; s.running = false; cancelAnimationFrame(this.swRaf); }
    else { s.start = performance.now(); s.running = true; const loop = () => { this.renderSw(); if (s.running) this.swRaf = requestAnimationFrame(loop); }; loop(); }
    this.renderSw(); this.updateFab();
  }
  renderSw() {
    const ms = this.swElapsed();
    const f = t => { const cs = Math.floor(t / 10) % 100, s = Math.floor(t / 1000) % 60, m = Math.floor(t / 60000); return `${m ? m + ':' + String(s).padStart(2, '0') : s}<small>.${String(cs).padStart(2, '0')}</small>`; };
    this.swDisplay.innerHTML = f(ms);
    const g = this.swCanvas.getContext('2d'); g.clearRect(0, 0, 560, 560); g.lineWidth = 8;
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(280, 280, 250, 0, 7); g.stroke();
    const a = -Math.PI / 2 + (ms % 60000) / 60000 * 2 * Math.PI;
    g.fillStyle = '#fff'; g.beginPath(); g.arc(280 + Math.cos(a) * 250, 280 + Math.sin(a) * 250, 12, 0, 7); g.fill();
    this.swActions.hidden = ms === 0;
    this.swLaps.innerHTML = this.sw.laps.map((l, i, arr) => `<div class="lap"><span># ${arr.length - i}</span><span>${f(l - (arr[i + 1] || 0))}</span><span>${f(l)}</span></div>`).join('');
  }
}

registerApp({ id: 'clock', label: 'Clock', icon: 'clock', color: '#0277bd', colorDark: '#0277bd', accent: '#80cbc4', pkg: 'com.android.deskclock' }, DeskClock);
