// Keyguard (lock screen) with swipe, PIN and pattern security - after frameworks/base/packages/Keyguard
import { h, vector, icon, fmtTime, fmtDateShort, clamp, drag, sleep } from '../core/dom.js';
import { prefs } from '../core/prefs.js';
import { sys } from '../core/system.js';
import { nm } from '../core/notifications.js';
import { playEffect, click, vibrate } from '../core/sound.js';
import { createStatusIcons } from './statusbar.js';
import { notificationCard } from './shade.js';

export function createKeyguard(screen) {
  const clock = h('div.kg-clock');
  const date = h('div.kg-date');
  const notifs = h('div.kg-notifs');
  const hint = h('div.kg-hint', 'Swipe up to unlock');
  const lockIcon = vector('ic_lock_24dp', 'kg-lock');
  const phoneBtn = h('button.kg-affordance.left.rip.rip-u', { title: 'Phone' }, icon('phone'));
  const camBtn = h('button.kg-affordance.right.rip.rip-u', { title: 'Camera' }, icon('camera'));
  const content = h('div.kg-content', null,
    h('div.kg-status', h('div.kg-carrier', 'Android'), createStatusIcons()),
    h('div.kg-clock-area', clock, date),
    notifs,
    h('div.kg-bottom', phoneBtn, h('div.kg-center', hint, lockIcon), camBtn));
  const bouncer = h('div.kg-bouncer');
  const root = h('div#keyguard', null, h('div.kg-scrim'), content, bouncer);
  screen.append(root);

  let pendingAction = null;
  const tick = () => {
    const d = new Date();
    clock.textContent = fmtTime(d, prefs.get('time_24'));
    const alarm = prefs.get('next_alarm');
    date.textContent = fmtDateShort(d) + (alarm ? `  ⏰ ${alarm}` : '');
  };
  setInterval(tick, 1000); tick();
  prefs.on('*', tick);

  const renderNotifs = () => {
    notifs.innerHTML = '';
    nm.list().slice(0, 4).forEach(n => notifs.append(notificationCard(n, {
      onOpen: x => { pendingAction = () => { if (!x.ongoing) nm.cancel(x.id); x.onClick ? x.onClick() : x.appId && sys.launch(x.appId, x.intent || {}); }; tryUnlock(); },
      onDismiss: x => nm.cancel(x.id),
    })));
  };
  nm.on(renderNotifs);

  function show() {
    if (prefs.get('lock_type') === 'none') { sys.locked = false; sys.emit('lock', false); return; }
    sys.locked = true;
    root.classList.add('showing');
    content.style.transform = ''; content.style.opacity = '';
    bouncer.innerHTML = ''; bouncer.classList.remove('showing'); content.hidden = false;
    renderNotifs();
    sys.emit('lock', true);
  }
  async function unlock() {
    if (prefs.get('lock_sounds')) playEffect('Unlock', 'system', 0.5);
    root.classList.add('unlocking');
    await root.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(1.05)' }], { duration: 250, easing: 'ease-in' }).finished;
    root.classList.remove('showing', 'unlocking');
    sys.locked = false;
    sys.emit('lock', false);
    const a = pendingAction; pendingAction = null;
    a && a();
  }
  function tryUnlock() {
    const t = prefs.get('lock_type');
    if (t === 'pin' && prefs.get('lock_pin')) showPin();
    else if (t === 'pattern' && prefs.get('lock_pattern')) showPattern();
    else unlock();
  }
  function showBouncer(el) {
    bouncer.innerHTML = ''; bouncer.append(el); bouncer.classList.add('showing');
    content.hidden = true;
  }
  function cancelBouncer() {
    bouncer.classList.remove('showing'); bouncer.innerHTML = ''; content.hidden = false;
    content.style.transform = ''; content.style.opacity = ''; pendingAction = null;
  }

  function showPin() {
    let entry = '';
    const msg = h('div.kg-msg', 'Enter PIN');
    const dots = h('div.pin-entry');
    const render = () => { dots.textContent = '•'.repeat(entry.length); };
    const letters = ['', '', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ'];
    const key = d => h('button.pin-key.rip.rip-u', { onclick: () => { click(); if (entry.length < 16) entry += d; render(); } }, h('div.pk-digit', d), h('div.pk-letters', letters[d] || ''));
    const check = async () => {
      if (entry === prefs.get('lock_pin')) unlock();
      else { msg.textContent = 'Wrong PIN'; vibrate(200); dots.animate([{ transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'none' }], { duration: 200, iterations: 2 }); entry = ''; render(); await sleep(1500); msg.textContent = 'Enter PIN'; }
    };
    const pad = h('div.pin-pad', null, [1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => key(String(d))),
      h('button.pin-key.rip.rip-u', { onclick: () => { entry = entry.slice(0, -1); render(); } }, icon('backspace')),
      key('0'),
      h('button.pin-key.ok.rip.rip-u', { onclick: check }, icon('check')));
    showBouncer(h('div.kg-pin', h('div.kg-bouncer-top', vector('ic_lock_24dp', 'kg-lock'), msg), dots, pad,
      h('button.kg-cancel.rip', { onclick: cancelBouncer }, 'Cancel')));
  }

  function showPattern() {
    const msg = h('div.kg-msg', 'Draw your pattern');
    const view = patternView(async seq => {
      if (seq === prefs.get('lock_pattern')) { view.flash('ok'); unlock(); }
      else { msg.textContent = 'Wrong Pattern'; vibrate(200); view.flash('err'); await sleep(1200); view.clear(); msg.textContent = 'Draw your pattern'; }
    });
    showBouncer(h('div.kg-pattern', h('div.kg-bouncer-top', vector('ic_lock_24dp', 'kg-lock'), msg), view, h('button.kg-cancel.rip', { onclick: cancelBouncer }, 'Cancel')));
  }

  // swipe up on lock screen
  let h0 = 0;
  drag(content, {
    start: e => { if (e.target.closest('.notification')) return false; h0 = content.offsetHeight; },
    move: (dx, dy) => { const y = Math.min(0, dy); content.style.transform = `translateY(${y}px)`; content.style.opacity = 1 + y / h0 * 1.5; },
    end: (dx, dy, vx, vy) => {
      if (dy < -h0 * 0.25 || vy < -0.6) { pendingAction = null; tryUnlock(); }
      else { content.animate([{ transform: content.style.transform }, { transform: 'none' }], { duration: 200 }); content.style.transform = ''; content.style.opacity = ''; }
    },
  });
  content.addEventListener('click', e => {
    if (e.target.closest('button,.notification')) return;
    hint.classList.add('show'); lockIcon.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-10px)' }, { transform: 'none' }], { duration: 400 });
    setTimeout(() => hint.classList.remove('show'), 1500);
  });
  const affordance = (btn, dir, app) => {
    drag(btn, { axis: 'x', move: dx => { if (dx * dir > 0) btn.style.transform = `translateX(${dx}px) scale(${1 + Math.abs(dx) / 200})`; },
      end: dx => { btn.style.transform = ''; if (dx * dir > 60) { pendingAction = () => sys.launch(app); tryUnlock(); } } });
    btn.addEventListener('click', () => { hint.textContent = dir > 0 ? 'Swipe right for phone' : 'Swipe left for camera'; hint.classList.add('show'); setTimeout(() => { hint.classList.remove('show'); hint.textContent = 'Swipe up to unlock'; }, 1500); });
  };
  affordance(phoneBtn, 1, 'phone');
  affordance(camBtn, -1, 'camera');

  const back = () => { if (bouncer.classList.contains('showing')) { cancelBouncer(); return true; } return root.classList.contains('showing'); };
  return { show, unlock, tryUnlock, back, isShowing: () => root.classList.contains('showing'), lockSound: () => prefs.get('lock_sounds') && playEffect('Lock', 'system', 0.5) };
}

// LockPatternView: 3x3 grid; returns sequence like "0-1-2-5-8"
export function patternView(onDone, { size = 260 } = {}) {
  const cvs = h('canvas.pattern-view', { width: size * 2, height: size * 2, style: { width: size + 'px', height: size + 'px' } });
  const ctx = cvs.getContext('2d');
  const pts = [...Array(9)].map((_, i) => ({ x: (i % 3 + 0.5) * size / 3, y: (Math.floor(i / 3) + 0.5) * size / 3 }));
  let seq = [], cur = null, state = 'draw', drawing = false;
  const accent = () => getComputedStyle(cvs).getPropertyValue('--accent').trim() || '#80cbc4';
  const draw = () => {
    ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.clearRect(0, 0, size, size);
    const color = state === 'err' ? '#f44336' : state === 'ok' ? accent() : '#fff';
    ctx.strokeStyle = color; ctx.globalAlpha = 0.6; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath();
    seq.forEach((i, k) => k ? ctx.lineTo(pts[i].x, pts[i].y) : ctx.moveTo(pts[i].x, pts[i].y));
    if (cur && seq.length) ctx.lineTo(cur.x, cur.y);
    ctx.stroke(); ctx.globalAlpha = 1;
    pts.forEach((p, i) => { ctx.fillStyle = seq.includes(i) ? color : 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(p.x, p.y, seq.includes(i) ? 8 : 4, 0, 7); ctx.fill(); });
  };
  const pos = e => { const r = cvs.getBoundingClientRect(); return { x: (e.clientX - r.left) * size / r.width, y: (e.clientY - r.top) * size / r.height }; };
  const hit = p => { pts.forEach((q, i) => { if (!seq.includes(i) && Math.hypot(q.x - p.x, q.y - p.y) < size / 9) { seq.push(i); vibrate(10); } }); };
  cvs.addEventListener('pointerdown', e => { e.stopPropagation(); cvs.setPointerCapture(e.pointerId); seq = []; state = 'draw'; drawing = true; cur = pos(e); hit(cur); draw(); });
  cvs.addEventListener('pointermove', e => { if (!drawing) return; cur = pos(e); hit(cur); draw(); });
  cvs.addEventListener('pointerup', () => { if (!drawing) return; drawing = false; cur = null; draw(); if (seq.length) onDone(seq.join('-'), seq.length); });
  cvs.flash = s => { state = s; draw(); };
  cvs.clear = () => { seq = []; state = 'draw'; draw(); };
  draw();
  return cvs;
}
