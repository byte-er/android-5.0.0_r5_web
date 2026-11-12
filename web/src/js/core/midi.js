// MIDI playback through the AOSP Sonivox EAS synthesizer compiled to WebAssembly
// (external/sonivox/arm-wt-22k -> web/native -> sonivox.wasm), as used by
// MidiFile.cpp in mediaserver. Renders a whole file to a WAV blob.
import { fetchBytes, hasAsset } from './assets.js';

let inst = null;
export const midiAvailable = () => hasAsset('media/sonivox.wasm');

async function load() {
  if (inst) return inst;
  let mem;
  const env = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, log10: Math.log10, pow: Math.pow, atan: Math.atan, atan2: Math.atan2,
    js_now_ms: () => performance.now(), js_log: () => {},
  };
  const { instance } = await WebAssembly.instantiate(await fetchBytes('media/sonivox.wasm'), { env });
  inst = instance.exports;
  return inst;
}

function wav(pcm, rate, channels) {
  const h = new DataView(new ArrayBuffer(44));
  const w = (o, s) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); h.setUint32(4, 36 + pcm.byteLength, true); w(8, 'WAVEfmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true);
  h.setUint16(22, channels, true); h.setUint32(24, rate, true); h.setUint32(28, rate * channels * 2, true); h.setUint16(32, channels * 2, true);
  h.setUint16(34, 16, true); w(36, 'data'); h.setUint32(40, pcm.byteLength, true);
  return new Blob([h.buffer, pcm], { type: 'audio/wav' });
}

/** Renders SMF/XMF/RTTTL/iMelody/OTA bytes; returns { blob, seconds, ms }. */
export async function renderMidi(bytes, maxSeconds = 600) {
  const x = await load();
  const data = new Uint8Array(bytes);
  const p = x.web_malloc(data.length);
  new Uint8Array(x.memory.buffer, p, data.length).set(data);
  const t0 = performance.now();
  const n = x.eas_web_render(p, data.length, maxSeconds);
  x.web_free(p);
  if (n <= 0) throw new Error('EAS error ' + n);
  const out = x.eas_web_output();
  const pcm = x.memory.buffer.slice(out, out + n);
  const rate = x.eas_web_sample_rate(), ch = x.eas_web_channels();
  return { blob: wav(pcm, rate, ch), seconds: n / 2 / ch / rate, ms: performance.now() - t0 };
}
