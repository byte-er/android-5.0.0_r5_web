/* Loader for svoxpico.wasm: AOSP's SVOX Pico TTS engine compiled to WebAssembly. */
export class PicoTTS {
  static async create(wasmBytes) {
    const t = new PicoTTS();
    const env = {
      sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log,
      log10: Math.log10, pow: Math.pow, atan: Math.atan, atan2: Math.atan2,
      js_now_ms: () => performance.now(),
      js_log: (p, n) => console.log('[pico]', new TextDecoder().decode(new Uint8Array(t.mem.buffer, p, n))),
    };
    const { instance } = await WebAssembly.instantiate(wasmBytes, { env });
    t.x = instance.exports;
    t.mem = t.x.memory;
    t.lang = null;
    return t;
  }
  cstr(s) {
    const b = new TextEncoder().encode(s + '\0');
    const p = this.x.web_malloc(b.length);
    new Uint8Array(this.mem.buffer, p, b.length).set(b);
    return p;
  }
  addFile(name, bytes) {
    const p = this.x.web_malloc(bytes.byteLength);
    new Uint8Array(this.mem.buffer, p, bytes.byteLength).set(new Uint8Array(bytes));
    const n = this.cstr(name);
    this.x.web_register_file(n, p, bytes.byteLength);
    this.x.web_free(n);
  }
  load(taName, sgName) {
    const a = this.cstr(taName), b = this.cstr(sgName);
    const st = this.x.pico_web_load(a, b);
    this.x.web_free(a); this.x.web_free(b);
    if (st !== 0) throw new Error('pico_web_load failed: ' + st);
  }
  /* Returns Int16Array PCM at 16 kHz. rate/pitch are percentages (100 = normal). */
  synth(text, { rate = 100, pitch = 100 } = {}) {
    const esc = text.replace(/[<>&]/g, ' ');
    const p = this.cstr(`<speed level="${rate | 0}"><pitch level="${pitch | 0}">${esc}</pitch></speed>`);
    const n = this.x.pico_web_synth(p);
    this.x.web_free(p);
    if (n < 0) throw new Error('pico_web_synth failed: ' + n);
    const out = this.x.pico_web_output();
    return new Int16Array(this.mem.buffer.slice(out, out + n));
  }
}
