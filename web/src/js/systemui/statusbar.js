// PhoneStatusBar: status bar icons, clock, notification icons.
import { h, vector, icon, fmtTime } from '../core/dom.js';
import { prefs } from '../core/prefs.js';
import { nm } from '../core/notifications.js';
import { battery, drawBattery } from './battery.js';

export function networkLevel() {
  if (!navigator.onLine) return 0;
  const t = navigator.connection && navigator.connection.effectiveType;
  return ({ '4g': 4, '3g': 3, '2g': 2, 'slow-2g': 1 })[t] ?? 4;
}

export function smallIcon(n) {
  const s = n.smallIcon || 'mdi:info';
  return s.startsWith('mdi:') ? icon(s.slice(4)) : vector(s);
}

export function createStatusIcons(cls = '') {
  const wrap = h('div.status-icons' + (cls ? '.' + cls : ''));
  const batt = h('canvas.battery-meter');
  const render = () => {
    wrap.innerHTML = '';
    if (prefs.get('bluetooth')) wrap.append(vector('stat_sys_data_bluetooth', 'si'));
    if (prefs.get('ringer_mode') === 'vibrate') wrap.append(vector('stat_sys_ringer_vibrate', 'si'));
    if (prefs.get('ringer_mode') === 'silent') wrap.append(vector('stat_sys_zen_none', 'si'));
    if (prefs.get('next_alarm')) wrap.append(vector('stat_sys_alarm', 'si'));
    if (prefs.get('cast')) wrap.append(vector('stat_sys_cast', 'si'));
    if (prefs.get('hotspot')) wrap.append(vector('stat_sys_tether_wifi', 'si'));
    if (prefs.get('airplane')) wrap.append(vector('stat_sys_airplane_mode', 'si'));
    else {
      const lvl = networkLevel();
      if (prefs.get('wifi')) wrap.append(vector(navigator.onLine ? `stat_sys_wifi_signal_${lvl}_fully` : 'stat_sys_wifi_signal_0', 'si wifi'));
      if (!prefs.get('wifi') && prefs.get('data')) wrap.append(vector('stat_sys_data_fully_connected_lte', 'si'));
      wrap.append(vector(prefs.get('data') ? 'stat_sys_signal_4_fully' : 'stat_sys_signal_null', 'si signal'));
    }
    wrap.append(batt);
    requestAnimationFrame(() => drawBattery(batt, battery));
  };
  render();
  prefs.on('*', render);
  battery.listeners.push(render);
  window.addEventListener('online', render); window.addEventListener('offline', render);
  if (navigator.connection) navigator.connection.addEventListener?.('change', render);
  return wrap;
}

export function createClock(cls = 'sb-clock', withAmPm = false) {
  const el = h('div.' + cls);
  const tick = () => {
    const d = new Date();
    el.textContent = fmtTime(d, prefs.get('time_24')) + (withAmPm && !prefs.get('time_24') ? (d.getHours() < 12 ? ' AM' : ' PM') : '');
  };
  tick();
  setInterval(tick, 1000);
  prefs.on('time_24', tick);
  return el;
}

export function createStatusBar() {
  const notifIcons = h('div.notif-icons');
  const bar = h('div#statusbar', null, notifIcons, h('div.sb-right', createStatusIcons(), createClock()));
  const renderNotifs = () => {
    notifIcons.innerHTML = '';
    const list = nm.list();
    list.slice(0, 5).forEach(n => notifIcons.append(smallIcon(n)));
    if (list.length > 5) notifIcons.append(vector('stat_notify_more'));
  };
  nm.on(renderNotifs);
  renderNotifs();
  return bar;
}
