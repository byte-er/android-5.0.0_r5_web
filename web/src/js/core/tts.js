// TextToSpeech service backed by the AOSP SVOX Pico engine compiled to WebAssembly
// (external/svox/pico -> web/native -> svoxpico.wasm).
import { PicoTTS } from '../pico.js';
import { fetchBytes, hasAsset } from './assets.js';
import { audioCtx, streamVolume } from './sound.js';
import { prefs } from './prefs.js';
import { VOICES } from '@gen';

let engine = null, loadedLang = null, loading = null, current = null;

export const ttsLanguages = () => Object.keys(VOICES).filter(l => hasAsset(`tts/${l}_ta.bin`));
export const ttsAvailable = () => hasAsset('tts/svoxpico.wasm') && ttsLanguages().length > 0;

async function ensure(lang) {
  if (!engine) engine = await PicoTTS.create(await fetchBytes('tts/svoxpico.wasm'));
  if (!ttsLanguages().includes(lang)) lang = ttsLanguages()[0];
  if (loadedLang === lang) return;
  const ta = `${lang}_ta.bin`, sg = `${lang}_${VOICES[lang]}_sg.bin`;
  engine.addFile(ta, await fetchBytes('tts/' + ta));
  engine.addFile(sg, await fetchBytes('tts/' + sg));
  engine.load(ta, sg);
  loadedLang = lang;
}

export async function speak(text, opts = {}) {
  stopSpeaking();
  const lang = opts.lang || prefs.get('tts_lang');
  loading = (loading || Promise.resolve()).then(() => ensure(lang));
  await loading;
  const t0 = performance.now();
  const pcm = engine.synth(text, { rate: opts.rate ?? prefs.get('tts_rate'), pitch: opts.pitch ?? prefs.get('tts_pitch') });
  const synthMs = performance.now() - t0;
  const c = audioCtx();
  if (!c || !pcm.length) return { synthMs, seconds: 0 };
  const buf = c.createBuffer(1, pcm.length, 16000);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
  const src = c.createBufferSource(); src.buffer = buf;
  const g = c.createGain(); g.gain.value = Math.max(0.05, streamVolume('media'));
  src.connect(g).connect(c.destination); src.start();
  current = src;
  return new Promise(res => { src.onended = () => { if (current === src) current = null; res({ synthMs, seconds: pcm.length / 16000 }); }; });
}
export function stopSpeaking() { if (current) { try { current.stop(); } catch {} current = null; } }
