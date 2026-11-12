// AudioManager + SoundPool + ToneGenerator on top of Web Audio.
import { asset, fetchBytes, listAssets } from './assets.js';
import { prefs } from './prefs.js';

let ctx = null;
const buffers = new Map();
export function audioCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
// unlock audio on first gesture (autoplay policy)
['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => audioCtx(), { once: true, capture: true }));

async function buffer(key) {
  if (buffers.has(key)) return buffers.get(key);
  const p = (async () => {
    const c = audioCtx();
    const bytes = await fetchBytes(key);
    return await new Promise((res, rej) => c.decodeAudioData(bytes, res, rej));
  })();
  buffers.set(key, p);
  p.catch(() => buffers.delete(key));
  return p;
}

const STREAM_VOL = { system: 'vol_ring', ring: 'vol_ring', media: 'vol_media', alarm: 'vol_alarm', notification: 'vol_notification' };
export function streamVolume(stream) {
  const mode = prefs.get('ringer_mode');
  if ((stream === 'ring' || stream === 'notification' || stream === 'system') && mode !== 'normal') return 0;
  return prefs.get(STREAM_VOL[stream] || 'vol_media') ?? 0.7;
}

export async function playEffect(name, stream = 'system', gain = 0.6) {
  const c = audioCtx(); if (!c) return;
  const vol = streamVolume(stream) * gain;
  if (vol <= 0) return;
  try {
    const b = await buffer(`sound/effects/${name}.ogg`);
    const src = c.createBufferSource(); src.buffer = b;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(g).connect(c.destination); src.start();
  } catch {}
}
export const click = () => prefs.get('touch_sounds') && playEffect('Effect_Tick', 'system', 0.5);
export const keyClick = (k = 'Standard') => prefs.get('touch_sounds') && playEffect('Keypress' + k, 'system', 0.5);

export function vibrate(ms = 30) { try { navigator.vibrate && navigator.vibrate(ms); } catch {} }

export const soundList = kind => listAssets(`sound/${kind}/`).map(k => k.split('/').pop().replace('.ogg', ''));
export const soundKey = (kind, name) => `sound/${kind}/${name}.ogg`;

// Ringtone: a looping or one-shot media player on a given stream.
export class Ringtone {
  constructor(kind, name, stream, loop = false) { this.key = soundKey(kind, name); this.stream = stream; this.loop = loop; this.src = null; }
  async play() {
    const c = audioCtx(); if (!c) return;
    let k = this.key;
    if (!asset(k)) { const kind = k.split('/')[1]; const first = soundList(kind)[0]; if (!first) return; k = soundKey(kind, first); }
    try {
      const b = await buffer(k);
      if (this.stopped) return;
      this.gain = c.createGain(); this.gain.gain.value = streamVolume(this.stream);
      this.src = c.createBufferSource(); this.src.buffer = b; this.src.loop = this.loop;
      this.src.connect(this.gain).connect(c.destination); this.src.start();
      this.src.onended = () => this.onended && this.onended();
    } catch {}
  }
  stop() { this.stopped = true; try { this.src && this.src.stop(); } catch {} }
}
export function playNotificationSound() {
  if (prefs.get('ringer_mode') === 'vibrate') { vibrate([80, 80, 80]); return; }
  new Ringtone('notifications', prefs.get('notification_sound'), 'notification').play();
}

// ToneGenerator: DTMF (frameworks/av/media/libmedia/ToneGenerator.cpp frequencies)
const DTMF = { '1': [697, 1209], '2': [697, 1336], '3': [697, 1477], '4': [770, 1209], '5': [770, 1336], '6': [770, 1477], '7': [852, 1209], '8': [852, 1336], '9': [852, 1477], '*': [941, 1209], '0': [941, 1336], '#': [941, 1477] };
export function dtmf(key, ms = 150) {
  const c = audioCtx(); if (!c || !DTMF[key] || !prefs.get('dial_tones')) return;
  const vol = streamVolume('system') * 0.15; if (!vol) return;
  const g = c.createGain(); g.gain.value = vol; g.connect(c.destination);
  const t = c.currentTime;
  for (const f of DTMF[key]) { const o = c.createOscillator(); o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + ms / 1000); }
}
// Ring-back tone (TONE_SUP_RINGTONE: 440+480 Hz, 2s on / 4s off - North America)
export function ringback() {
  const c = audioCtx(); if (!c) return { stop() {} };
  const g = c.createGain(); g.gain.value = 0; g.connect(c.destination);
  const vol = streamVolume('media') * 0.12;
  const os = [440, 480].map(f => { const o = c.createOscillator(); o.frequency.value = f; o.connect(g); o.start(); return o; });
  const t0 = c.currentTime;
  for (let i = 0; i < 20; i++) { g.gain.setValueAtTime(vol, t0 + i * 6); g.gain.setValueAtTime(0, t0 + i * 6 + 2); }
  return { stop() { os.forEach(o => { try { o.stop(); } catch {} }); g.disconnect(); } };
}
