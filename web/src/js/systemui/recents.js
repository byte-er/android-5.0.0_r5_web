// RecentsActivity (Lollipop "Overview"): a stack of task cards with live snapshots.
import { h, vector, drag } from '../core/dom.js';
import { asset } from '../core/assets.js';
import { sys } from '../core/system.js';
import { STRINGS } from '@gen';
import { click } from '../core/sound.js';

function snapshot(task, w) {
  const src = task.el;
  const W = src.offsetWidth || 360, H = src.offsetHeight || 568;
  const clone = src.cloneNode(true);
  clone.hidden = false;
  clone.removeAttribute('id');
  clone.classList.add('snapshot');
  // copy canvas pixels (clone doesn't)
  const a = src.querySelectorAll('canvas'), b = clone.querySelectorAll('canvas');
  a.forEach((c, i) => { try { b[i].getContext('2d').drawImage(c, 0, 0); } catch {} });
  const v = src.querySelectorAll('video'), vb = clone.querySelectorAll('video');
  v.forEach((vid, i) => { try { const c = h('canvas', { width: vid.videoWidth, height: vid.videoHeight }); c.getContext('2d').drawImage(vid, 0, 0); c.style.cssText = vid.style.cssText; c.className = vid.className; vb[i].replaceWith(c); } catch {} });
  clone.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
  clone.querySelectorAll('iframe').forEach(f => f.replaceWith(h('div.iframe-placeholder')));
  Object.assign(clone.style, { width: W + 'px', height: H + 'px', transform: `scale(${w / W})`, transformOrigin: '0 0', position: 'absolute', left: 0, top: 0, pointerEvents: 'none', animation: 'none' });
  const box = h('div.rc-thumb', { style: { height: (H * w / W) + 'px' } }, clone);
  return box;
}

export function createRecents(screen) {
  const list = h('div.rc-list');
  const empty = h('div.rc-empty', STRINGS.recents_empty_message || 'No recent screens');
  const root = h('div#recents', null, list, empty);
  screen.append(root);
  let unback = null;

  function open() {
    if (unback) return close();
    const tasks = sys.tasks.slice();
    list.innerHTML = '';
    empty.hidden = tasks.length > 0;
    const w = Math.min(screen.offsetWidth - 32, 340);
    tasks.forEach((t, i) => {
      const m = t.manifest;
      const card = h('div.rc-card', { style: { width: w + 'px', zIndex: i } },
        h('div.rc-header', { style: { background: m.color || '#607d8b' } },
          h('img.rc-icon', { src: asset(`icon/${m.icon}.png`) || '' }),
          h('div.rc-title', m.label),
          h('button.rc-dismiss.rip.rip-u', { onclick: e => { e.stopPropagation(); dismiss(card, t, 1); } }, vector('recents_dismiss_light'))),
        snapshot(t, w));
      card.addEventListener('click', () => { click(); select(t, card); });
      drag(card, { axis: 'x',
        move: dx => { card.style.transform = `translateX(${dx}px)`; card.style.opacity = 1 - Math.abs(dx) / w; },
        end: (dx, dy, vx) => { if (Math.abs(dx) > w * 0.35 || Math.abs(vx) > 0.8) dismiss(card, t, Math.sign(dx || vx)); else { card.style.transform = ''; card.style.opacity = ''; } } });
      list.append(card);
    });
    root.classList.add('showing');
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    [...list.children].forEach((c, i, arr) => c.animate([{ transform: `translateY(${(arr.length - i) * 40 + 100}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, delay: (arr.length - 1 - i) * 30, easing: 'cubic-bezier(0,0,.2,1)', fill: 'backwards' }));
    unback = sys.pushBack(close);
    sys.emit('recents', true);
  }
  function close() {
    if (!unback) return;
    unback(); unback = null;
    root.classList.remove('showing');
    sys.emit('recents', false);
  }
  async function select(task, card) {
    close();
    await sys.resumeFromRecents(task);
  }
  function dismiss(card, task, dir) {
    card.animate([{ transform: card.style.transform || 'none' }, { transform: `translateX(${dir * 120}%)`, opacity: 0 }], { duration: 180 }).finished.then(() => {
      card.remove(); sys.destroy(task);
      empty.hidden = sys.tasks.length > 0;
    });
  }
  return { open, close, isOpen: () => !!unback };
}
