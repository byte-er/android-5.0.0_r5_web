// Material (Theme.Material) widgets: Toolbar, lists, Switch, SeekBar, dialogs, toasts...
import { h, icon, clamp, drag } from './dom.js';
import { sys } from './system.js';
import { click } from './sound.js';

let overlay = null;
export function setOverlayRoot(el) { overlay = el; }

export function toolbar({ title, back, actions = [], menu, cls = '', sub } = {}) {
  const t = h('div.toolbar' + (cls ? '.' + cls : ''),
    back ? h('button.tb-btn.rip.rip-u', { onclick: back, 'aria-label': 'Navigate up' }, icon('back')) : null,
    h('div.tb-titles', h('div.tb-title', title || ''), sub ? h('div.tb-sub', sub) : null),
    ...actions.map(a => h('button.tb-btn.rip.rip-u', { onclick: a.onClick, title: a.label || '' }, icon(a.icon))),
    menu ? h('button.tb-btn.rip.rip-u', { onclick: e => popupMenu(e.currentTarget, typeof menu === 'function' ? menu() : menu), title: 'More options' }, icon('more')) : null);
  t.setTitle = s => { t.querySelector('.tb-title').textContent = s; };
  return t;
}

export function listItem({ icon: ic, title, summary, onClick, widget, cls = '', avatar, tag = 'div' } = {}) {
  const el = h(tag + '.list-item' + (onClick ? '.rip' : '') + (cls ? '.' + cls : ''), { onclick: onClick ? e => { click(); onClick(e); } : null },
    avatar || (ic ? h('div.li-icon', typeof ic === 'string' ? icon(ic) : ic) : null),
    h('div.li-text', h('div.li-title', title), summary != null ? h('div.li-summary', summary) : null),
    widget || null);
  el.setSummary = s => { let x = el.querySelector('.li-summary'); if (!x) { x = h('div.li-summary'); el.querySelector('.li-text').append(x); } x.textContent = s; };
  return el;
}
export const subheader = text => h('div.subheader', text);
export const divider = () => h('div.divider');

export function switchEl(checked, onChange) {
  const el = h('button.switch' + (checked ? '.on' : ''), { role: 'switch', 'aria-checked': String(!!checked) }, h('span.sw-track'), h('span.sw-thumb.rip.rip-u'));
  el.checked = !!checked;
  el.set = v => { el.checked = !!v; el.classList.toggle('on', el.checked); el.setAttribute('aria-checked', String(el.checked)); };
  el.addEventListener('click', e => { e.stopPropagation(); el.set(!el.checked); onChange && onChange(el.checked); });
  return el;
}
export function switchItem(opts) {
  const sw = switchEl(opts.checked, opts.onChange);
  const li = listItem({ ...opts, widget: sw, onClick: () => sw.click() });
  li.sw = sw;
  return li;
}
export function checkbox(checked, onChange) {
  const el = h('button.checkbox' + (checked ? '.on' : ''), null, h('span.cb-box'));
  el.checked = !!checked;
  el.set = v => { el.checked = !!v; el.classList.toggle('on', el.checked); };
  el.addEventListener('click', e => { e.stopPropagation(); el.set(!el.checked); onChange && onChange(el.checked); });
  return el;
}
export function radio(checked) { return h('span.radio' + (checked ? '.on' : ''), null, h('span.rd-dot')); }

export function slider(value, onInput, { min = 0, max = 1, step = 0, onEnd } = {}) {
  const el = h('div.slider', null, h('div.sl-track', h('div.sl-fill')), h('div.sl-thumb'));
  let v = value;
  const render = () => { const p = (v - min) / (max - min) * 100; el.querySelector('.sl-fill').style.width = p + '%'; el.querySelector('.sl-thumb').style.left = `calc(8px + (100% - 16px) * ${p / 100})`; };
  el.set = x => { v = x; render(); };
  const fromEvent = e => {
    const r = el.getBoundingClientRect();
    let x = clamp((e.clientX - r.left - 8) / (r.width - 16), 0, 1) * (max - min) + min;
    if (step) x = Math.round(x / step) * step;
    v = x; render(); onInput && onInput(v);
  };
  el.addEventListener('pointerdown', e => {
    e.stopPropagation(); el.setPointerCapture(e.pointerId); el.classList.add('active'); fromEvent(e);
    const mv = ev => fromEvent(ev);
    const up = () => { el.classList.remove('active'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); onEnd && onEnd(v); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
  requestAnimationFrame(render); render();
  return el;
}

export function button(label, onClick, cls = 'flat') { return h('button.btn.rip.' + cls, { onclick: e => { click(); onClick && onClick(e); } }, label); }
export function fab(ic, onClick, cls = '') { return h('button.fab.rip' + (cls ? '.' + cls : ''), { onclick: e => { click(); onClick(e); } }, typeof ic === 'string' ? icon(ic) : ic); }

// AlertDialog
export function dialog({ title, message, view, items, singleChoice, buttons = [], onDismiss, cls = '' }) {
  const scrim = h('div.dialog-scrim');
  const box = h('div.dialog' + (cls ? '.' + cls : ''));
  let closed = false, unback;
  const close = () => {
    if (closed) return; closed = true; unback && unback();
    box.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.9)' }], { duration: 150 }).finished.then(() => scrim.remove());
    onDismiss && onDismiss();
  };
  if (title) box.append(h('div.dlg-title', title));
  if (message) box.append(h('div.dlg-message', message));
  if (view) box.append(h('div.dlg-view', view));
  if (items) box.append(h('div.dlg-items', items.map((it, i) =>
    h('div.dlg-item.rip', { onclick: () => { click(); close(); it.onClick && it.onClick(i); } },
      singleChoice ? radio(singleChoice.selected === i) : null, h('span', it.label || it)))));
  if (buttons.length) box.append(h('div.dlg-buttons', buttons.map(b =>
    h('button.btn.flat.rip', { onclick: () => { click(); if (b.onClick && b.onClick() === false) return; close(); } }, b.label))));
  scrim.append(box);
  scrim.addEventListener('pointerdown', e => { if (e.target === scrim) close(); });
  overlay.append(scrim);
  box.animate([{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 180, easing: 'cubic-bezier(0,0,.2,1)' });
  unback = sys.pushBack(close);
  return { close, box };
}
export function prompt({ title, value = '', placeholder = '', type = 'text', ok = 'OK', onOk }) {
  const input = h('input.text-field', { value, placeholder, type });
  const d = dialog({ title, view: input, buttons: [{ label: 'Cancel' }, { label: ok, onClick: () => onOk && onOk(input.value) }] });
  setTimeout(() => input.focus(), 100);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { onOk && onOk(input.value); d.close(); } });
  return d;
}

let toastEl = null, toastTimer = null;
export function toast(msg, long = false) {
  if (!toastEl) { toastEl = h('div.toast'); overlay.append(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), long ? 3500 : 2000);
}

export function popupMenu(anchor, items) {
  const scrim = h('div.menu-scrim');
  const menu = h('div.popup-menu', null, items.filter(Boolean).map(it => h('div.menu-item.rip', { onclick: () => { click(); close(); it.onClick && it.onClick(); } }, it.label)));
  let unback;
  const close = () => { unback && unback(); scrim.remove(); };
  scrim.addEventListener('pointerdown', e => { if (e.target === scrim) close(); });
  scrim.append(menu);
  overlay.append(scrim);
  const o = overlay.getBoundingClientRect(), k = o.width / overlay.offsetWidth || 1, a = anchor.getBoundingClientRect();
  const right = (o.right - a.right) / k + 4, top = (a.top - o.top) / k + 4;
  Object.assign(menu.style, { right: right + 'px', top: top + 'px' });
  menu.animate([{ opacity: 0, transform: 'scale(0.8)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 150, easing: 'cubic-bezier(0,0,.2,1)' });
  unback = sys.pushBack(close);
}

// In-app navigation: a stack of pages with Material slide transitions.
export class PageStack {
  constructor(root) { this.root = root; this.stack = []; root.classList.add('page-stack'); }
  push(page, animate = true) {
    const prev = this.stack[this.stack.length - 1];
    page.classList.add('page');
    this.root.append(page);
    this.stack.push(page);
    if (animate && prev) page.animate([{ transform: 'translateX(30%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'cubic-bezier(0,0,.2,1)' }).finished.then(() => { if (this.top === page) prev.hidden = true; });
    else if (prev) prev.hidden = true;
    page.onShow && page.onShow();
    return page;
  }
  pop() {
    if (this.stack.length <= 1) return false;
    const page = this.stack.pop();
    const prev = this.top; prev.hidden = false; prev.onShow && prev.onShow();
    page.onHide && page.onHide();
    page.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(30%)', opacity: 0 }], { duration: 180, easing: 'cubic-bezier(.4,0,1,1)' }).finished.then(() => page.remove());
    return true;
  }
  reset(page) { this.stack.forEach(p => p.remove()); this.stack = []; this.push(page, false); }
  get top() { return this.stack[this.stack.length - 1]; }
  get depth() { return this.stack.length; }
}

export function tabs(labels, onSelect, { icons } = {}) {
  const bar = h('div.tabs');
  const ind = h('div.tab-indicator');
  const btns = labels.map((l, i) => h('button.tab.rip', { onclick: () => select(i) }, icons ? icons[i] : l));
  bar.append(...btns, ind);
  let cur = -1;
  function select(i, silent) {
    cur = i;
    btns.forEach((b, j) => b.classList.toggle('active', j === i));
    ind.style.width = 100 / labels.length + '%';
    ind.style.transform = `translateX(${i * 100}%)`;
    if (!silent) onSelect(i);
  }
  bar.select = select;
  return bar;
}

export function emptyState(ic, text) { return h('div.empty-state', icon(ic), h('div', text)); }
export { drag };
