// NotificationPanelView + QSPanel + HeadsUpNotificationView
import { h, vector, icon, clamp, fmtDateShort, fmtDate, drag } from '../core/dom.js';
import { prefs } from '../core/prefs.js';
import { nm } from '../core/notifications.js';
import { sys } from '../core/system.js';
import { slider, toast } from '../core/ui.js';
import { click } from '../core/sound.js';
import { STRINGS } from '@gen';
import { createStatusIcons, createClock, smallIcon, networkLevel } from './statusbar.js';
import { battery } from './battery.js';
import { appManifest } from '../core/system.js';
import { asset } from '../core/assets.js';

const S = (k, d) => STRINGS[k] || d;

let torchTrack = null;
async function setTorch(on) {
  try {
    if (on) {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      torchTrack = s.getVideoTracks()[0];
      const caps = torchTrack.getCapabilities ? torchTrack.getCapabilities() : {};
      if (caps.torch) await torchTrack.applyConstraints({ advanced: [{ torch: true }] });
      else { torchTrack.stop(); torchTrack = null; toast('This device has no flash'); }
    } else if (torchTrack) { torchTrack.stop(); torchTrack = null; }
  } catch { toast('Camera unavailable'); }
}

function tiles() {
  const lvl = networkLevel();
  return [
    { id: 'wifi', pref: 'wifi', label: () => prefs.get('wifi') ? (navigator.onLine ? 'Browser network' : S('quick_settings_wifi_label', 'Wi-Fi')) : S('quick_settings_wifi_label', 'Wi-Fi'),
      icon: () => prefs.get('wifi') ? (navigator.onLine ? `ic_qs_wifi_full_${lvl}` : 'ic_qs_wifi_no_network') : 'ic_qs_wifi_disabled', big: true, settings: 'wifi' },
    { id: 'bt', pref: 'bluetooth', label: () => S('quick_settings_bluetooth_label', 'Bluetooth'), icon: () => prefs.get('bluetooth') ? 'ic_qs_bluetooth_on' : 'ic_qs_bluetooth_off', big: true, settings: 'bluetooth' },
    { id: 'invert', pref: 'invert', label: () => S('quick_settings_inversion_label', 'Invert colors'), icon: () => prefs.get('invert') ? 'ic_qs_inversion_on' : 'ic_qs_inversion_off' },
    { id: 'data', pref: 'data', label: () => prefs.get('airplane') ? 'No SIM' : 'Android', icon: () => prefs.get('data') && !prefs.get('airplane') ? 'ic_qs_signal_full_4' : 'ic_qs_signal_disabled' },
    { id: 'airplane', pref: 'airplane', label: () => S('quick_settings_airplane_mode_label', 'Airplane mode'), icon: () => prefs.get('airplane') ? 'ic_qs_airplane_on' : 'ic_qs_airplane_off' },
    { id: 'rotate', pref: 'rotation_lock', invert: true, label: () => prefs.get('rotation_lock') ? S('quick_settings_rotation_locked_portrait_label', 'Portrait') : S('quick_settings_rotation_unlocked_label', 'Auto-rotate'),
      icon: () => prefs.get('rotation_lock') ? 'ic_qs_rotation_portrait' : 'ic_qs_rotation_unlocked' },
    { id: 'flashlight', pref: 'flashlight', label: () => S('quick_settings_flashlight_label', 'Flashlight'), icon: () => prefs.get('flashlight') ? 'ic_qs_flashlight_on' : 'ic_qs_flashlight_off', onToggle: setTorch },
    { id: 'location', pref: 'location', label: () => S('quick_settings_location_label', 'Location'), icon: () => prefs.get('location') ? 'ic_qs_location_on' : 'ic_qs_location_off' },
    { id: 'cast', pref: 'cast', label: () => S('quick_settings_cast_title', 'Cast screen'), icon: () => prefs.get('cast') ? 'ic_qs_cast_on' : 'ic_qs_cast_off' },
    { id: 'hotspot', pref: 'hotspot', label: () => S('quick_settings_hotspot_label', 'Hotspot'), icon: () => prefs.get('hotspot') ? 'ic_qs_hotspot_on' : 'ic_qs_hotspot_off' },
  ];
}

export function notificationCard(n, { onDismiss, onOpen, light = true } = {}) {
  const m = appManifest(n.appId) || {};
  const big = n.largeIcon ? h('img.nc-large', { src: n.largeIcon }) : h('div.nc-icon', { style: { background: n.color || m.accent || '#607d8b' } }, smallIcon(n));
  const card = h('div.notification.rip' + (light ? '' : '.dark'), null,
    big,
    h('div.nc-body',
      h('div.nc-top', h('div.nc-title', n.title || m.label || ''), h('div.nc-time', n.ongoing && !n.showWhen ? '' : timeOf(n.when))),
      n.text ? h('div.nc-text', n.text) : null,
      n.progress != null ? h('div.nc-progress', h('div', { style: { width: (n.progress * 100) + '%' } })) : null,
      n.actions ? h('div.nc-actions', n.actions.map(a => h('button.nc-action.rip', { onclick: e => { e.stopPropagation(); click(); a.onClick(); } }, a.icon ? icon(a.icon) : null, a.label || ''))) : null));
  card.addEventListener('click', () => { onOpen && onOpen(n); });
  if (!n.ongoing && onDismiss) {
    drag(card, {
      axis: 'x',
      move: dx => { card.style.transform = `translateX(${dx}px)`; card.style.opacity = 1 - Math.abs(dx) / card.offsetWidth; },
      end: (dx, dy, vx) => {
        if (Math.abs(dx) > card.offsetWidth * 0.4 || Math.abs(vx) > 0.8) {
          card.animate([{ transform: `translateX(${dx}px)` }, { transform: `translateX(${Math.sign(dx || vx) * card.offsetWidth * 1.2}px)`, opacity: 0 }], { duration: 150 }).finished.then(() => onDismiss(n));
        } else { card.style.transform = ''; card.style.opacity = ''; }
      },
    });
  }
  return card;
}
function timeOf(t) {
  const d = new Date(t); const is24 = prefs.get('time_24');
  return is24 ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

export function createShade(screen, statusbar) {
  const scrim = h('div.shade-scrim');
  const dateEl = h('div.sh-date');
  const battPct = h('div.sh-batt-pct');
  const header = h('div.shade-header', null,
    h('div.sh-left', createClock('sh-clock'), dateEl),
    h('div.sh-right', createStatusIcons('sh-icons'), battPct,
      h('button.sh-btn.rip.rip-u', { onclick: () => { close(); sys.launch('settings'); }, title: 'Settings' }, vector('ic_settings')),
      h('button.sh-btn.sh-user.rip.rip-u', { onclick: () => toast(prefs.get('user_name')), title: 'User' }, vector('ic_account_circle'))));
  const tileGrid = h('div.qs-tiles');
  const brightness = slider(prefs.get('brightness'), v => prefs.set('brightness', v), { min: 0.15, max: 1 });
  prefs.on('brightness', v => brightness.set(v));
  const qs = h('div.qs-panel', null, h('div.qs-brightness', icon('brightness'), brightness), tileGrid);
  const notifList = h('div.notif-list');
  const clearAll = h('button.clear-all.rip.rip-u', { title: S('status_bar_clear_all_button', 'Clear all'), onclick: () => { click(); dismissAllAnimated(); } }, vector('ic_dismiss_all'));
  const panel = h('div.shade-panel', null, header, qs, h('div.notif-scroll', notifList, clearAll), h('div.shade-handle'));
  const root = h('div#shade', null, scrim, panel);
  screen.append(root);

  let frac = 0, qsOpen = false, unback = null;
  const setFrac = (f, anim) => {
    frac = clamp(f, 0, 1);
    panel.style.transition = scrim.style.transition = anim ? 'transform 250ms cubic-bezier(0,0,.2,1), opacity 250ms' : 'none';
    panel.style.transform = `translateY(${(frac - 1) * 100}%)`;
    scrim.style.opacity = frac;
    root.classList.toggle('visible', frac > 0);
    statusbar.style.opacity = frac > 0.05 ? 0 : 1;
  };
  const setQs = (v, anim = true) => {
    qsOpen = v;
    qs.style.transition = anim ? 'max-height 300ms cubic-bezier(.4,0,.2,1), opacity 250ms' : 'none';
    qs.style.maxHeight = v ? qs.scrollHeight + 'px' : '0px';
    qs.style.opacity = v ? 1 : 0;
    panel.classList.toggle('qs-expanded', v);
  };
  function open(withQs = false) {
    renderTiles(); renderNotifs(); renderHeader();
    setFrac(1, true);
    setQs(withQs || nm.list().length === 0);
    if (!unback) unback = sys.pushBack(close);
  }
  function close() {
    setFrac(0, true);
    if (unback) { unback(); unback = null; }
    setTimeout(() => { if (frac === 0) setQs(false, false); }, 260);
  }
  const isOpen = () => frac > 0.5;

  function renderHeader() {
    dateEl.textContent = fmtDate(new Date());
    battPct.textContent = battery.level + '%';
  }
  function renderTiles() {
    tileGrid.innerHTML = '';
    for (const t of tiles()) {
      const on = t.invert ? !prefs.get(t.pref) : prefs.get(t.pref);
      const el = h('button.qs-tile.rip.rip-u' + (t.big ? '.big' : '') + (on ? '.on' : '.off'), {
        onclick: () => {
          click();
          const v = !prefs.get(t.pref);
          prefs.set(t.pref, v);
          t.onToggle && t.onToggle(v);
          renderTiles();
        },
      }, vector(t.icon(), 'qs-icon'), h('div.qs-label', t.label()));
      if (t.settings) el.addEventListener('contextmenu', e => { e.preventDefault(); close(); sys.launch('settings', { page: t.settings }); });
      tileGrid.append(el);
    }
  }
  function openNotification(n) {
    close();
    if (!n.ongoing && n.autoCancel !== false) nm.cancel(n.id);
    if (n.onClick) n.onClick(); else if (n.appId) sys.launch(n.appId, n.intent || {});
  }
  function renderNotifs() {
    notifList.innerHTML = '';
    const list = nm.list();
    for (const n of list) notifList.append(notificationCard(n, { onDismiss: x => nm.cancel(x.id), onOpen: openNotification }));
    clearAll.hidden = !list.some(n => !n.ongoing);
    panel.classList.toggle('empty', list.length === 0);
  }
  async function dismissAllAnimated() {
    const cards = [...notifList.children];
    const list = nm.list();
    cards.forEach((c, i) => { if (!list[i] || list[i].ongoing) return; c.animate([{ transform: 'none' }, { transform: 'translateX(110%)', opacity: 0 }], { duration: 200, delay: i * 40, fill: 'forwards' }); });
    await new Promise(r => setTimeout(r, 200 + cards.length * 40));
    nm.cancelAll();
    if (!nm.list().length) close();
  }
  nm.on(() => { if (frac > 0) renderNotifs(); });
  prefs.on('*', () => { if (frac > 0) renderTiles(); });

  // pull down on status bar
  let startFrac = 0, panelH = 0;
  const startDrag = () => { if (sys.locked && !sys.shadeOnKeyguard) return false; panelH = panel.offsetHeight || screen.offsetHeight; startFrac = frac; renderTiles(); renderNotifs(); renderHeader(); if (frac === 0) setQs(nm.list().length === 0, false); };
  const endDrag = (dx, dy, vx, vy) => {
    if ((vy > 0.3) || (vy > -0.3 && frac > 0.4)) open(qsOpen); else close();
  };
  drag(statusbar, { start: startDrag, move: (dx, dy) => setFrac(startFrac + dy / panelH), end: endDrag });
  // drag inside panel: on header => toggles QS; elsewhere upward => close
  drag(header, { start: () => {}, move: () => {}, end: (dx, dy) => { if (dy > 20) setQs(true); else if (dy < -20) { if (qsOpen && nm.list().length) setQs(false); else close(); } } });
  header.addEventListener('click', e => { if (e.target.closest('button')) return; setQs(!qsOpen); });
  drag(panel.querySelector('.shade-handle'), { start: () => { panelH = panel.offsetHeight; startFrac = frac; }, move: (dx, dy) => setFrac(startFrac + dy / panelH), end: endDrag });
  scrim.addEventListener('click', close);
  // second swipe down when list is scrolled to top expands QS
  const scroller = panel.querySelector('.notif-scroll');
  drag(scroller, { start: () => { if (scroller.scrollTop > 0) return false; }, move: () => {}, end: (dx, dy) => { if (dy > 40 && !qsOpen) setQs(true); else if (dy < -40 && scroller.scrollHeight <= scroller.clientHeight + 2) close(); } });

  setFrac(0);
  setQs(false, false);

  // ---- heads-up notifications (new in Lollipop)
  const hun = h('div.heads-up');
  screen.append(hun);
  let hunTimer;
  nm.on((type, n, isNew) => {
    if (type !== 'post' || !isNew || !n.headsUp || sys.locked || frac > 0 || !sys.screenOn) return;
    hun.innerHTML = '';
    hun.append(notificationCard(n, { onDismiss: () => hide(), onOpen: x => { hide(); openNotification(x); } }));
    hun.classList.add('show');
    clearTimeout(hunTimer);
    hunTimer = setTimeout(hide, n.headsUpMs || 4000);
  });
  const hide = () => hun.classList.remove('show');

  return { open, close, isOpen, toggle: () => isOpen() ? close() : open(), openQs: () => open(true) };
}
