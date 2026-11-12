// Launcher3 (Lollipop): workspace pages, hotseat, all-apps, drag & drop,
// overview mode and the WallpaperPicker.
import { h, icon, vector, clamp, drag, onLongPress, fmtTime, fmtDate } from '../core/dom.js';
import { asset, listAssets } from '../core/assets.js';
import { prefs } from '../core/prefs.js';
import { sys, installedApps, appManifest } from '../core/system.js';
import { click, vibrate } from '../core/sound.js';
import { toast, dialog, button } from '../core/ui.js';

const COLS = 4, ROWS = 5;
const LAYOUT_KEY = 'android5web.launcher';
const DEFAULT_LAYOUT = {
  hotseat: ['phone', 'contacts', null, 'messaging', 'browser'],
  pages: [
    [{ widget: 'clock', x: 0, y: 0, w: 4, h: 2 }, { app: 'camera', x: 0, y: 4 }, { app: 'gallery', x: 1, y: 4 }, { app: 'calculator', x: 2, y: 4 }, { app: 'settings', x: 3, y: 4 }],
    [{ app: 'music', x: 0, y: 0 }, { app: 'calendar', x: 1, y: 0 }, { app: 'recorder', x: 2, y: 0 }, { app: 'clock', x: 3, y: 0 }, { widget: 'analog', x: 1, y: 2, w: 2, h: 2 }],
  ],
};

function loadLayout() {
  try { const l = JSON.parse(localStorage.getItem(LAYOUT_KEY)); if (l && l.pages) return l; } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
}
const saveLayout = l => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(l)); } catch {} };
export const resetLauncherLayout = () => { try { localStorage.removeItem(LAYOUT_KEY); } catch {} };

function appIcon(id, { label = true, onClick } = {}) {
  const m = appManifest(id);
  if (!m) return null;
  const el = h('div.app-icon.rip', { 'data-app': id, title: m.label },
    h('img', { src: asset(`icon/${m.icon}.png`) || '', alt: '', draggable: false }),
    label ? h('div.app-label', m.label) : null);
  el.addEventListener('click', e => {
    if (el.dataset.dragging) return;
    click();
    onClick ? onClick(e) : sys.launch(id, {}, el.querySelector('img').getBoundingClientRect());
  });
  return el;
}

function clockWidget() {
  const t = h('div.cw-time'), ap = h('span.cw-ampm'), d = h('div.cw-date');
  const el = h('div.widget.clock-widget', { onclick: () => { click(); sys.launch('clock'); } }, h('div', t, ap), d);
  const tick = () => {
    const now = new Date();
    t.textContent = fmtTime(now, prefs.get('time_24'));
    ap.textContent = prefs.get('time_24') ? '' : (now.getHours() < 12 ? ' AM' : ' PM');
    d.textContent = fmtDate(now).toUpperCase() + (prefs.get('next_alarm') ? '  ⏰ ' + prefs.get('next_alarm') : '');
  };
  tick(); setInterval(tick, 1000); prefs.on('*', tick);
  return el;
}
function analogWidget() {
  const c = h('canvas', { width: 280, height: 280 });
  const el = h('div.widget.analog-widget', { onclick: () => { click(); sys.launch('clock'); } }, c);
  const draw = () => {
    const g = c.getContext('2d'), now = new Date(), R = 140;
    g.clearRect(0, 0, 280, 280);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.arc(R, R, R - 4, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineCap = 'round';
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.lineWidth = 4; g.beginPath(); g.moveTo(R + Math.sin(a) * (R - 22), R - Math.cos(a) * (R - 22)); g.lineTo(R + Math.sin(a) * (R - 12), R - Math.cos(a) * (R - 12)); g.stroke(); }
    const hand = (a, len, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(R, R); g.lineTo(R + Math.sin(a) * len, R - Math.cos(a) * len); g.stroke(); };
    const s = now.getSeconds(), m = now.getMinutes() + s / 60, hr = now.getHours() % 12 + m / 60;
    hand(hr * Math.PI / 6, 60, 10, '#fff'); hand(m * Math.PI / 30, 95, 6, '#fff'); hand(s * Math.PI / 30, 105, 2, '#80cbc4');
    g.fillStyle = '#80cbc4'; g.beginPath(); g.arc(R, R, 7, 0, 7); g.fill();
  };
  draw(); setInterval(draw, 1000);
  return el;
}
const WIDGETS = { clock: { label: 'Digital clock', w: 4, h: 2, make: clockWidget }, analog: { label: 'Analog clock', w: 2, h: 2, make: analogWidget } };

export function createLauncher(screen, wallpaperEl) {
  let layout = loadLayout();
  let page = 0;
  const search = h('div.qsb.rip', { onclick: () => { click(); sys.launch('browser', { focusUrl: true }); } }, icon('search'), h('span', 'Search'), icon('mic'));
  const dropBar = h('div.drop-bar', null, h('div.drop-target.remove', icon('close'), 'Remove'), h('div.drop-target.info', icon('info'), 'App info'));
  const pagesEl = h('div.ws-pages');
  const indicator = h('div.page-indicator');
  const hotseat = h('div.hotseat');
  const workspace = h('div.workspace', null, h('div.ws-top', search, dropBar), h('div.ws-viewport', pagesEl), indicator, hotseat);
  const overviewBar = h('div.overview-bar', null,
    h('button.ov-btn.rip', { onclick: () => { exitOverview(); openWallpaperPicker(); } }, icon('wallpaper'), 'WALLPAPERS'),
    h('button.ov-btn.rip', { onclick: () => { exitOverview(); openWidgets(); } }, icon('widgets'), 'WIDGETS'),
    h('button.ov-btn.rip', { onclick: () => { exitOverview(); sys.launch('settings'); } }, icon('settings'), 'SETTINGS'));
  const allApps = h('div.all-apps');
  const root = h('div#launcher', null, workspace, overviewBar, allApps);
  screen.append(root);

  // ---------------- rendering
  function render() {
    pagesEl.innerHTML = '';
    layout.pages.forEach((items, p) => {
      const grid = h('div.ws-page', { 'data-page': p });
      for (const it of items) {
        let el;
        if (it.widget) { const W = WIDGETS[it.widget]; if (!W) continue; el = W.make(); it.w = it.w || W.w; it.h = it.h || W.h; }
        else el = appIcon(it.app);
        if (!el) continue;
        el.style.gridColumn = `${it.x + 1} / span ${it.w || 1}`;
        el.style.gridRow = `${it.y + 1} / span ${it.h || 1}`;
        el.classList.add('ws-item');
        makeDraggable(el, it, p);
        grid.append(el);
      }
      onLongPress(grid, e => { if (e.target === grid) enterOverview(); });
      pagesEl.append(grid);
    });
    hotseat.innerHTML = '';
    layout.hotseat.forEach((id, i) => {
      if (i === 2) { hotseat.append(h('div.app-icon.allapps-btn.rip', { title: 'Apps', onclick: e => { click(); openAllApps(e.currentTarget); } }, h('img', { src: asset('launcher/ic_allapps.png') || '', draggable: false }))); return; }
      const el = id ? appIcon(id, { label: false }) : h('div.app-icon.empty');
      hotseat.append(el);
      if (id) makeDraggable(el, { app: id, hotseat: i }, -1);
    });
    indicator.innerHTML = '';
    layout.pages.forEach((_, i) => indicator.append(h('span.dot' + (i === page ? '.on' : ''))));
    setPage(page, false);
  }

  // ---------------- paging + wallpaper parallax
  function setPage(p, anim = true, dx = 0) {
    page = clamp(p, 0, layout.pages.length - 1);
    const w = pagesEl.parentElement.offsetWidth || screen.offsetWidth;
    pagesEl.style.transition = anim ? 'transform 350ms cubic-bezier(0,0,.2,1)' : 'none';
    pagesEl.style.transform = `translateX(${-page * w + dx}px)`;
    const n = layout.pages.length;
    const frac = n > 1 ? clamp((page * w - dx) / ((n - 1) * w), 0, 1) : 0.5;
    wallpaperEl.style.transition = anim ? 'background-position 350ms cubic-bezier(0,0,.2,1)' : 'none';
    wallpaperEl.style.backgroundPosition = `${frac * 100}% center`;
    [...indicator.children].forEach((d, i) => d.classList.toggle('on', i === page));
  }
  drag(workspace.querySelector('.ws-viewport'), {
    axis: 'x',
    start: () => !dragState && !root.classList.contains('overview'),
    move: dx => setPage(page, false, (page === 0 && dx > 0) || (page === layout.pages.length - 1 && dx < 0) ? dx * 0.3 : dx),
    end: (dx, dy, vx) => {
      const w = pagesEl.parentElement.offsetWidth;
      if (dx < -w / 3 || vx < -0.4) setPage(page + 1); else if (dx > w / 3 || vx > 0.4) setPage(page - 1); else setPage(page);
    },
  });
  // swipe up anywhere on the workspace opens all apps; swipe down opens the shade
  drag(workspace, {
    axis: 'y', start: e => !dragState && !e.target.closest('.hotseat') && !root.classList.contains('overview'),
    move: () => {}, end: (dx, dy) => { if (dy < -80) openAllApps(hotseat.children[2]); else if (dy > 60) sys.emit('open-shade'); },
  });
  workspace.addEventListener('wheel', e => { if (Math.abs(e.deltaX) > 30) setPage(page + Math.sign(e.deltaX)); }, { passive: true });

  // ---------------- drag and drop (DragController)
  let dragState = null;
  function makeDraggable(el, item, pageIdx) {
    onLongPress(el, e => startDrag(el, item, pageIdx, e));
  }
  function cellAt(clientX, clientY) {
    const grid = pagesEl.children[page];
    if (!grid) return null;
    const r = grid.getBoundingClientRect();
    if (clientY < r.top || clientY > r.bottom) return null;
    return { x: clamp(Math.floor((clientX - r.left) / r.width * COLS), 0, COLS - 1), y: clamp(Math.floor((clientY - r.top) / r.height * ROWS), 0, ROWS - 1) };
  }
  const occupied = (p, x, y, w = 1, hh = 1, except) => layout.pages[p].some(it => it !== except &&
    x < it.x + (it.w || 1) && x + w > it.x && y < it.y + (it.h || 1) && y + hh > it.y);
  function startDrag(el, item, pageIdx, ev) {
    vibrate(30);
    const s = screen.getBoundingClientRect(), k = s.width / screen.offsetWidth;
    const r = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, { width: r.width / k + 'px', height: r.height / k + 'px', left: (r.left - s.left) / k + 'px', top: (r.top - s.top) / k + 'px', gridColumn: '', gridRow: '' });
    screen.append(ghost);
    el.style.visibility = 'hidden';
    el.dataset.dragging = '1';
    root.classList.add('dragging');
    const offX = ev.clientX - r.left, offY = ev.clientY - r.top;
    const hint = h('div.drop-hint');
    dragState = { el, item, pageIdx, ghost };
    let edgeTimer = null, last = null;
    const move = e => {
      last = e;
      ghost.style.left = (e.clientX - offX - s.left) / k + 'px';
      ghost.style.top = (e.clientY - offY - s.top) / k + 'px';
      const sr = screen.getBoundingClientRect();
      const edge = e.clientX < sr.left + 20 * k ? -1 : e.clientX > sr.right - 20 * k ? 1 : 0;
      if (edge && !edgeTimer) edgeTimer = setTimeout(() => { edgeTimer = null; if (edge > 0 && page === layout.pages.length - 1) { layout.pages.push([]); render(); } setPage(page + edge); }, 500);
      if (!edge) { clearTimeout(edgeTimer); edgeTimer = null; }
      [...dropBar.children].forEach(t => { const tr = t.getBoundingClientRect(); t.classList.toggle('hover', e.clientX > tr.left && e.clientX < tr.right && e.clientY > tr.top && e.clientY < tr.bottom + 10 * k); });
      const c = cellAt(e.clientX - offX + r.width / 2, e.clientY - offY + r.height / 2);
      const grid = pagesEl.children[page];
      if (c && grid) {
        hint.style.gridColumn = `${c.x + 1} / span ${item.w || 1}`; hint.style.gridRow = `${c.y + 1} / span ${item.h || 1}`;
        grid.append(hint);
      } else hint.remove();
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      clearTimeout(edgeTimer); hint.remove();
      const e = last;
      const target = [...dropBar.children].find(t => t.classList.contains('hover'));
      const remove = () => {
        if (item.hotseat != null) layout.hotseat[item.hotseat] = null;
        else layout.pages[pageIdx].splice(layout.pages[pageIdx].indexOf(item), 1);
      };
      if (target && target.classList.contains('remove')) remove();
      else if (target && target.classList.contains('info')) { if (item.app) sys.launch('settings', { page: 'app', app: item.app }); }
      else if (e) {
        const hr = hotseat.getBoundingClientRect();
        if (item.app && e.clientY > hr.top) {
          const slot = clamp(Math.floor((e.clientX - hr.left) / hr.width * 5), 0, 4);
          if (slot !== 2) {
            const prev = layout.hotseat[slot];
            remove();
            if (prev && item.hotseat != null) layout.hotseat[item.hotseat] = prev;
            else if (prev) placeOnPage(prev, page);
            layout.hotseat[slot] = item.app;
          }
        } else {
          const c = cellAt(e.clientX - offX + r.width / 2, e.clientY - offY + r.height / 2);
          const w = item.w || 1, hh = item.h || 1;
          if (c && c.x + w <= COLS && c.y + hh <= ROWS && !occupied(page, c.x, c.y, w, hh, item)) {
            remove();
            const it = item.widget ? { widget: item.widget, x: c.x, y: c.y, w, h: hh } : { app: item.app, x: c.x, y: c.y };
            layout.pages[page].push(it);
          }
        }
      }
      // drop empty trailing pages
      while (layout.pages.length > 1 && !layout.pages[layout.pages.length - 1].length && page !== layout.pages.length - 1) layout.pages.pop();
      saveLayout(layout);
      ghost.remove(); root.classList.remove('dragging'); dragState = null;
      render();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }
  function placeOnPage(app, p) {
    for (let pp = p; pp < layout.pages.length + 1; pp++) {
      if (!layout.pages[pp]) layout.pages.push([]);
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!occupied(pp, x, y)) { layout.pages[pp].push({ app, x, y }); return pp; }
    }
  }
  function placeWidget(widget) {
    const W = WIDGETS[widget];
    for (let pp = page; pp < layout.pages.length + 1; pp++) {
      if (!layout.pages[pp]) layout.pages.push([]);
      for (let y = 0; y <= ROWS - W.h; y++) for (let x = 0; x <= COLS - W.w; x++)
        if (!occupied(pp, x, y, W.w, W.h)) { layout.pages[pp].push({ widget, x, y, w: W.w, h: W.h }); return pp; }
    }
  }

  // ---------------- all apps (AppsCustomizePagedView)
  let unbackAll = null;
  function openAllApps(from) {
    if (unbackAll) return;
    const apps = installedApps().sort((a, b) => a.label.localeCompare(b.label));
    const perPage = 4 * 5;
    const pages = [];
    for (let i = 0; i < apps.length; i += perPage) pages.push(apps.slice(i, i + perPage));
    const dots = h('div.page-indicator.dark', null, pages.map((_, i) => h('span.dot' + (i ? '' : '.on'))));
    const scroller = h('div.aa-pages', null, pages.map(pg => h('div.aa-page', null, pg.map(m => {
      const el = appIcon(m.id, { onClick: e => { closeAllApps(); sys.launch(m.id, {}, e.currentTarget.querySelector('img').getBoundingClientRect()); } });
      onLongPress(el, () => { closeAllApps(true); placeOnPage(m.id, page); saveLayout(layout); render(); toast(`${m.label} added to Home screen`); });
      return el;
    }))));
    scroller.addEventListener('scroll', () => { const i = Math.round(scroller.scrollLeft / scroller.clientWidth); [...dots.children].forEach((d, j) => d.classList.toggle('on', i === j)); });
    allApps.innerHTML = '';
    allApps.append(h('div.aa-panel', null, h('div.aa-tabs', h('span.on', 'APPS'), h('span', { onclick: () => { closeAllApps(); openWidgets(); } }, 'WIDGETS')), scroller, dots));
    allApps.classList.add('showing');
    // circular reveal from the all-apps button (Lollipop's signature animation)
    const s = screen.getBoundingClientRect(), k = s.width / screen.offsetWidth;
    const b = (from || hotseat).getBoundingClientRect();
    const cx = (b.left + b.width / 2 - s.left) / k, cy = (b.top + b.height / 2 - s.top) / k;
    const R = Math.hypot(Math.max(cx, screen.offsetWidth - cx), Math.max(cy, screen.offsetHeight - cy));
    allApps.animate([{ clipPath: `circle(0px at ${cx}px ${cy}px)` }, { clipPath: `circle(${R}px at ${cx}px ${cy}px)` }], { duration: 350 * sys.animScale(), easing: 'cubic-bezier(.4,0,.2,1)' });
    workspace.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    unbackAll = sys.pushBack(() => closeAllApps());
    allApps._from = { cx, cy, R };
  }
  function closeAllApps(instant) {
    if (!unbackAll) return;
    unbackAll(); unbackAll = null;
    workspace.getAnimations().forEach(a => a.cancel());
    const { cx, cy, R } = allApps._from;
    if (instant) { allApps.classList.remove('showing'); return; }
    allApps.animate([{ clipPath: `circle(${R}px at ${cx}px ${cy}px)` }, { clipPath: `circle(0px at ${cx}px ${cy}px)` }], { duration: 250 * sys.animScale(), easing: 'cubic-bezier(.4,0,.2,1)' })
      .finished.then(() => { if (!unbackAll) allApps.classList.remove('showing'); });
  }

  // ---------------- overview mode
  let unbackOv = null;
  function enterOverview() {
    if (unbackOv) return;
    vibrate(30);
    root.classList.add('overview');
    unbackOv = sys.pushBack(exitOverview);
  }
  function exitOverview() { if (!unbackOv) return; unbackOv(); unbackOv = null; root.classList.remove('overview'); }

  function openWidgets() {
    dialog({
      title: 'Widgets',
      items: Object.entries(WIDGETS).map(([id, W]) => ({ label: `${W.label}  (${W.w}×${W.h})`, onClick: () => { const p = placeWidget(id); saveLayout(layout); render(); setPage(p); } })),
      buttons: [{ label: 'Cancel' }],
    });
  }

  // ---------------- WallpaperPicker (packages/apps/Launcher3/WallpaperPicker)
  function openWallpaperPicker() {
    const keys = listAssets('wallpaper/');
    const colors = ['#263238', '#3f51b5', '#009688', '#e91e63', '#ff9800', '#000000'];
    let selected = prefs.get('wallpaper');
    const preview = h('div.wp-preview');
    const setPreview = v => { selected = v; preview.style.background = v.startsWith('#') ? v : `url(${asset(v)}) center/cover`; strip.querySelectorAll('.wp-thumb').forEach(t => t.classList.toggle('on', t.dataset.v === v)); };
    const strip = h('div.wp-strip', null,
      h('label.wp-thumb.wp-pick.rip', null, icon('photo'), h('span', 'Pick image'),
        h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { try { localStorage.setItem('android5web.customwp', rd.result); } catch { toast('Image too large to keep'); } setPreview('custom'); preview.style.background = `url(${rd.result}) center/cover`; }; rd.readAsDataURL(f); } })),
      keys.map(k => h('div.wp-thumb.rip', { 'data-v': k, style: { backgroundImage: `url(${asset(k)})` }, onclick: () => setPreview(k) })),
      colors.map(c => h('div.wp-thumb.rip', { 'data-v': c, style: { background: c }, onclick: () => setPreview(c) })));
    const picker = h('div.wallpaper-picker', null, preview,
      h('div.wp-bar', h('button.wp-set.rip', { onclick: () => { click(); prefs.set('wallpaper', selected); close(); } }, icon('check'), 'Set wallpaper')), strip);
    screen.append(picker);
    picker.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0,0,.2,1)' });
    setPreview(selected === 'custom' ? 'custom' : selected);
    if (selected === 'custom') { const d = localStorage.getItem('android5web.customwp'); if (d) preview.style.background = `url(${d}) center/cover`; }
    const unback = sys.pushBack(() => close());
    function close() { unback(); picker.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }], { duration: 200 }).finished.then(() => picker.remove()); }
  }

  sys.on('home-pressed-on-home', () => { if (unbackAll) closeAllApps(); else if (unbackOv) exitOverview(); else setPage(0); });
  sys.on('home', () => { closeAllApps(true); exitOverview(); });
  window.addEventListener('resize', () => setPage(page, false));
  render();
  return { root, render, openWallpaperPicker, reset: () => { resetLauncherLayout(); layout = loadLayout(); page = 0; render(); } };
}

export function applyWallpaper(el) {
  const v = prefs.get('wallpaper');
  let bg;
  if (v === 'custom') bg = `url(${localStorage.getItem('android5web.customwp')})`;
  else if (v && v.startsWith('#')) bg = v;
  else bg = `url(${asset(v) || asset('wallpaper/lollipop.jpg')})`;
  document.documentElement.style.setProperty('--wallpaper', bg.startsWith('#') ? bg : bg);
  el.style.backgroundImage = bg.startsWith('#') ? 'none' : bg;
  el.style.backgroundColor = bg.startsWith('#') ? bg : '#000';
}
