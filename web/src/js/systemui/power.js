// GlobalActions dialog (long-press power) + screen on/off + screen timeout.
import { h, icon } from '../core/dom.js';
import { prefs } from '../core/prefs.js';
import { dialog } from '../core/ui.js';
import { sys } from '../core/system.js';
import { click } from '../core/sound.js';

export function globalActions({ powerOff, reboot }) {
  const ringer = h('div.ga-ringer', null, [['silent', 'silent'], ['vibrate', 'vibrate'], ['normal', 'volume']].map(([m, ic]) =>
    h('button.ga-ring.rip.rip-u' + (prefs.get('ringer_mode') === m ? '.on' : ''), { onclick: () => { click(); prefs.set('ringer_mode', m); d.close(); } }, icon(ic))));
  const item = (ic, label, fn, sub) => h('div.ga-item.rip', { onclick: () => { click(); d.close(); fn(); } }, icon(ic), h('div', h('div', label), sub ? h('div.ga-sub', sub) : null));
  const d = dialog({
    cls: 'global-actions',
    view: h('div', null,
      item('power', 'Power off', powerOff),
      item('restart', 'Reboot', reboot),
      item('airplane', 'Airplane mode', () => prefs.set('airplane', !prefs.get('airplane')), prefs.get('airplane') ? 'Airplane mode is ON' : 'Airplane mode is OFF'),
      ringer),
  });
  return d;
}

export function createScreenOff(screen) {
  const el = h('div#screen-off');
  screen.append(el);
  let timer = null;
  const reset = () => {
    clearTimeout(timer);
    const t = prefs.get('screen_off_timeout');
    if (sys.screenOn && t > 0 && !sys.keepScreenOn) timer = setTimeout(() => sys.emit('timeout'), t);
  };
  ['pointerdown', 'keydown', 'wheel'].forEach(e => window.addEventListener(e, reset, { capture: true, passive: true }));
  prefs.on('screen_off_timeout', reset);
  return { el, reset };
}
