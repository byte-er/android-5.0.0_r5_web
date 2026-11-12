// VolumePanel (Lollipop): appears at the top; ringer stream by default, media while playing.
import { h, icon, vector } from '../core/dom.js';
import { prefs } from '../core/prefs.js';
import { slider } from '../core/ui.js';
import { playEffect, vibrate } from '../core/sound.js';

export function createVolumePanel(screen) {
  const ic = h('div.vol-icon');
  let stream = 'ring';
  const sl = slider(0.5, v => setVol(v), { min: 0, max: 1, step: 1 / 15, onEnd: () => stream !== 'media' && playEffect('Effect_Tick', stream === 'alarm' ? 'alarm' : 'ring', 1) });
  const modes = h('div.vol-modes');
  const root = h('div#volume', null, h('div.vol-row', ic, sl), modes);
  screen.append(root);
  let timer;
  const key = () => ({ ring: 'vol_ring', media: 'vol_media', alarm: 'vol_alarm' })[stream];
  function setVol(v) {
    prefs.set(key(), v);
    if (stream === 'ring') prefs.set('ringer_mode', v === 0 ? 'vibrate' : 'normal');
    render(); poke();
  }
  function render() {
    const v = prefs.get(key());
    sl.set(v);
    ic.innerHTML = '';
    if (stream === 'media') ic.append(vector(v ? 'ic_audio_vol' : 'ic_audio_vol_mute'));
    else if (stream === 'alarm') ic.append(vector('ic_audio_alarm'));
    else ic.append(vector(prefs.get('ringer_mode') === 'vibrate' ? 'ic_audio_ring_notif_vibrate' : prefs.get('ringer_mode') === 'silent' ? 'ic_audio_ring_notif_mute' : 'ic_audio_ring_notif'));
    modes.innerHTML = '';
    if (stream === 'ring') {
      for (const [m, label] of [['silent', 'None'], ['vibrate', 'Priority'], ['normal', 'All']]) {
        modes.append(h('button.vol-mode.rip' + (prefs.get('ringer_mode') === m ? '.on' : ''), { onclick: () => { prefs.set('ringer_mode', m); render(); poke(); } }, label));
      }
    }
  }
  function poke() { clearTimeout(timer); timer = setTimeout(() => root.classList.remove('showing'), 3000); }
  function adjust(dir, s = 'ring') {
    stream = s;
    const step = 1 / 15;
    if (!root.classList.contains('showing')) { root.classList.add('showing'); render(); poke(); return; }
    let v = Math.max(0, Math.min(1, prefs.get(key()) + dir * step));
    if (stream === 'ring' && v === 0 && dir < 0) vibrate(100);
    setVol(Math.round(v * 15) / 15);
    if (stream !== 'media') playEffect('Effect_Tick', stream === 'alarm' ? 'alarm' : 'ring', 1);
  }
  root.addEventListener('pointerdown', poke);
  return { adjust };
}
