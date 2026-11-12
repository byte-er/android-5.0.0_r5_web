// NavigationBarView (KeyButtonView x3) using SystemUI's own xxhdpi bitmaps.
import { h } from '../core/dom.js';
import { asset } from '../core/assets.js';
import { sys } from '../core/system.js';
import { click, vibrate } from '../core/sound.js';

export function createNavBar({ onBack, onHome, onRecents, onHomeLong }) {
  const key = (name, label, fn, longFn) => {
    const b = h('button.nav-key.rip.rip-u', { 'aria-label': label, title: label },
      h('img', { src: asset(`sysui/${name}.png`) || '', alt: '', draggable: false }));
    let timer, long = false;
    b.addEventListener('pointerdown', () => { long = false; vibrate(15); if (longFn) timer = setTimeout(() => { long = true; longFn(); }, 600); });
    b.addEventListener('pointerup', () => clearTimeout(timer));
    b.addEventListener('pointerleave', () => clearTimeout(timer));
    b.addEventListener('click', () => { if (long) return; click(); fn(); });
    return b;
  };
  return h('div#navbar', null,
    key('ic_sysbar_back', 'Back', onBack),
    key('ic_sysbar_home', 'Home', onHome, onHomeLong),
    key('ic_sysbar_recent', 'Overview', onRecents));
}
