// Talking Pip: an original talking-pet app for Android 5.0 for the web.
// Pip listens through the microphone, waits for you to stop speaking and repeats
// you in a squeaky voice (playbackRate pitch-up), and reacts to pokes and strokes.
// All art and sounds are original (inline SVG + Web Audio synthesis). Packaged
// with apk2wapk as the replacement for a talking-pet APK whose code can't run here.
export default function createApp(android) {
  const { App, h, icon, ui } = android;

  const PIP_SVG = `
<svg class="pip-svg" viewBox="0 0 300 340" xmlns="http://www.w3.org/2000/svg">
  <ellipse class="pip-shadow" cx="150" cy="322" rx="92" ry="12" fill="#000" opacity=".18"/>
  <g class="pip-body">
    <g class="pip-ear-l"><path d="M92 92 L70 22 L128 74 Z" fill="#9575cd"/><path d="M96 84 L82 40 L118 74 Z" fill="#f8bbd0"/></g>
    <g class="pip-ear-r"><path d="M208 92 L230 22 L172 74 Z" fill="#9575cd"/><path d="M204 84 L218 40 L182 74 Z" fill="#f8bbd0"/></g>
    <ellipse cx="150" cy="190" rx="118" ry="122" fill="#b39ddb"/>
    <path d="M60 130 Q70 100 92 92 M240 130 Q230 100 208 92" stroke="#9575cd" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M138 70 Q150 44 156 70 Q166 52 168 76" stroke="#9575cd" stroke-width="7" fill="none" stroke-linecap="round"/>
    <ellipse class="pip-belly" cx="150" cy="232" rx="66" ry="60" fill="#ede7f6"/>
    <g class="pip-eyes">
      <ellipse cx="112" cy="160" rx="27" ry="30" fill="#fff"/><ellipse cx="188" cy="160" rx="27" ry="30" fill="#fff"/>
      <g class="pip-pupils"><circle cx="116" cy="164" r="14" fill="#311b92"/><circle cx="192" cy="164" r="14" fill="#311b92"/>
        <circle cx="121" cy="158" r="5" fill="#fff"/><circle cx="197" cy="158" r="5" fill="#fff"/></g>
      <g class="pip-lids"><rect x="82" y="126" width="62" height="0" fill="#b39ddb"/><rect x="158" y="126" width="62" height="0" fill="#b39ddb"/></g>
    </g>
    <ellipse cx="88" cy="196" rx="13" ry="8" fill="#f48fb1" opacity=".6"/><ellipse cx="212" cy="196" rx="13" ry="8" fill="#f48fb1" opacity=".6"/>
    <g class="pip-mouth"><ellipse cx="150" cy="200" rx="20" ry="4" fill="#4527a0"/><ellipse class="pip-tongue" cx="150" cy="204" rx="10" ry="0" fill="#f06292"/></g>
    <ellipse class="pip-foot-l" cx="104" cy="306" rx="30" ry="14" fill="#9575cd"/><ellipse class="pip-foot-r" cx="196" cy="306" rx="30" ry="14" fill="#9575cd"/>
  </g>
</svg>`;

  return class TalkingPip extends App {
    onCreate(root) {
      this.state = 'idle';
      this.status = h('div.pip-status', 'Tap the microphone and talk to Pip');
      this.stage = h('div.pip-stage', { html: PIP_SVG });
      this.micBtn = h('button.pip-mic.rip.rip-u', { title: 'Listen', onclick: () => this.toggleMic() }, icon('mic'));
      const act = (ic, label, fn) => h('button.pip-act.rip.rip-u', { onclick: () => { android.sound.click(); fn(); } }, icon(ic), h('span', label));
      this.el = h('div.pip', null,
        h('div.pip-top', h('div.pip-title', android.manifest.label), h('button.tb-btn.rip.rip-u', { title: 'Close', onclick: () => this.finish() }, icon('close'))),
        this.status, this.stage,
        h('div.pip-actions', act('star', 'Snack', () => this.feed()), act('music', 'Sing', () => this.sing()), this.micBtn, act('message', 'Say…', () => this.sayText()), act('person', 'Pet', () => this.purr())),
        h('div.pip-hint', 'Poke Pip’s head, tickle the belly, or stroke Pip to purr.'));
      root.append(this.el);
      this.svg = this.stage.querySelector('svg');
      this.mouth = this.svg.querySelector('.pip-mouth ellipse');
      this.tongue = this.svg.querySelector('.pip-tongue');
      this.lids = [...this.svg.querySelectorAll('.pip-lids rect')];
      this.body = this.svg.querySelector('.pip-body');
      this.setupTouch();
      this.blinkTimer = setInterval(() => { if (Math.random() < 0.5) this.blink(); }, 2500);
      this.mouthLevel = 0;
      const loop = () => { this.renderMouth(); this.raf = requestAnimationFrame(loop); };
      loop();
    }
    onPause() { this.stopMic(); }
    onDestroy() { this.stopMic(); clearInterval(this.blinkTimer); cancelAnimationFrame(this.raf); android.tts.stop(); }

    // ------------------------------------------------------------ animation helpers
    setStatus(t) { this.status.textContent = t; }
    anim(sel, kf, opts) { const el = typeof sel === 'string' ? this.svg.querySelector(sel) : sel; return el && el.animate(kf, { duration: 300, ...opts }); }
    blink() {
      this.lids.forEach(l => l.animate([{ height: '0px' }, { height: '62px', offset: 0.5 }, { height: '0px' }], { duration: 220 }));
    }
    squash(sy = 0.88, dur = 260) {
      this.body.style.transformOrigin = '150px 320px';
      this.body.animate([{ transform: 'scale(1,1)' }, { transform: `scale(${2 - sy},${sy})` }, { transform: 'scale(1,1)' }], { duration: dur, easing: 'cubic-bezier(.3,1.6,.6,1)' });
    }
    hop() {
      this.body.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-46px)', offset: 0.45 }, { transform: 'translateY(0)', offset: 0.85 }, { transform: 'scale(1.06,.92)', offset: 0.92 }, { transform: 'none' }], { duration: 600, easing: 'ease-out' });
    }
    ears(on) { ['.pip-ear-l', '.pip-ear-r'].forEach((s, i) => { const e = this.svg.querySelector(s); e.style.transformOrigin = i ? '200px 90px' : '100px 90px'; e.style.transition = 'transform 200ms'; e.style.transform = on ? `rotate(${i ? 8 : -8}deg) translateY(-6px)` : ''; }); }
    renderMouth() {
      let lvl = this.mouthLevel;
      if (this.outAnalyser) {
        const d = new Uint8Array(this.outAnalyser.fftSize); this.outAnalyser.getByteTimeDomainData(d);
        let pk = 0; for (const v of d) pk = Math.max(pk, Math.abs(v - 128) / 128); lvl = Math.max(lvl, Math.min(1, pk * 2.2));
      }
      this.mouth.setAttribute('ry', String(4 + lvl * 26));
      this.tongue.setAttribute('ry', String(lvl * 10));
      this.tongue.setAttribute('cy', String(204 + lvl * 12));
    }

    // ------------------------------------------------------------ synthesized sounds (Web Audio)
    ctx() { return android.sound.audioContext(); }
    tone(freqs, { type = 'sine', dur = 0.15, gap = 0, vol = 0.25, slide = 0 } = {}) {
      const c = this.ctx(); if (!c) return 0;
      const g0 = vol * Math.max(0.1, android.sound.mediaVolume());
      let t = c.currentTime;
      for (const f of freqs) {
        const o = c.createOscillator(), g = c.createGain();
        o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(g0, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
        t += dur + gap;
      }
      const total = (t - c.currentTime) * 1000;
      this.mouthLevel = 0.6; clearTimeout(this.mouthT); this.mouthT = setTimeout(() => { this.mouthLevel = 0; }, total);
      return total;
    }
    noise(dur, { vol = 0.2, filter = 900, am = 0 } = {}) {
      const c = this.ctx(); if (!c) return;
      const b = c.createBuffer(1, c.sampleRate * dur, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (am ? 0.5 + 0.5 * Math.sin(i / c.sampleRate * 2 * Math.PI * am) : 1);
      const s = c.createBufferSource(); s.buffer = b;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter;
      const g = c.createGain(); g.gain.value = vol * Math.max(0.1, android.sound.mediaVolume());
      g.gain.setValueAtTime(g.gain.value, c.currentTime + dur * 0.8); g.gain.linearRampToValueAtTime(0, c.currentTime + dur);
      s.connect(f).connect(g).connect(c.destination); s.start();
    }

    // ------------------------------------------------------------ touch reactions
    setupTouch() {
      let sx = 0, sy = 0, moved = 0, last = null;
      this.svg.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; moved = 0; last = e; });
      this.svg.addEventListener('pointermove', e => {
        if (!last || !(e.buttons & 1)) return;
        moved += Math.hypot(e.clientX - last.clientX, e.clientY - last.clientY); last = e;
        if (moved > 220 && !this.purring) this.purr();
      });
      this.svg.addEventListener('pointerup', e => {
        if (!last) return; last = null;
        if (moved > 30) return;
        const r = this.svg.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
        if (y < 0.38) this.poke(); else if (y < 0.82) this.tickle(); else this.stomp();
      });
    }
    poke() { android.sound.vibrate(30); this.squash(0.8); this.blink(); this.tone([880], { type: 'triangle', dur: 0.18, slide: 0.55 }); this.setStatus('Ouch!'); }
    tickle() { this.squash(0.94, 200); setTimeout(() => this.squash(0.94, 200), 220); this.tone([660, 780, 700, 820, 740], { type: 'sine', dur: 0.08, gap: 0.03, vol: 0.2 }); this.setStatus('Hee hee!'); }
    stomp() { this.hop(); this.tone([300, 420], { type: 'square', dur: 0.09, gap: 0.2, vol: 0.12 }); this.setStatus('Boing!'); }
    purr() {
      this.purring = true; this.setStatus('Purrrr…');
      this.lids.forEach(l => l.animate([{ height: '0px' }, { height: '40px', offset: 0.2 }, { height: '40px', offset: 0.8 }, { height: '0px' }], { duration: 1800 }));
      this.noise(1.8, { vol: 0.35, filter: 260, am: 24 });
      setTimeout(() => { this.purring = false; }, 1900);
    }
    feed() {
      const snack = h('div.pip-snack');
      this.stage.append(snack);
      snack.animate([{ transform: 'translate(120px,-160px) scale(1)', opacity: 1 }, { transform: 'translate(0,-40px) scale(.6)', opacity: 1, offset: 0.7 }, { transform: 'translate(0,-20px) scale(.1)', opacity: 0 }], { duration: 900, easing: 'ease-in' }).finished.then(() => snack.remove());
      setTimeout(() => { for (let i = 0; i < 4; i++) setTimeout(() => { this.noise(0.07, { vol: 0.3, filter: 2500 }); this.mouthLevel = i % 2 ? 0.2 : 0.7; }, i * 160); setTimeout(() => { this.mouthLevel = 0; this.tone([520, 660, 880], { dur: 0.1, gap: 0.02 }); this.setStatus('Yum!'); }, 700); }, 650);
    }
    sing() {
      // An original little tune (scale degrees of C major pentatonic)
      const N = { C: 523.25, D: 587.33, E: 659.25, G: 783.99, A: 880, c: 1046.5 };
      const tune = 'E G A G E D C D E E D'.split(' ').map(n => N[n]);
      const ms = this.tone(tune, { type: 'triangle', dur: 0.22, gap: 0.04, vol: 0.22 });
      this.setStatus('♪ La la la ♪');
      const sway = this.body.animate([{ transform: 'rotate(-4deg)' }, { transform: 'rotate(4deg)' }], { duration: 520, iterations: Math.ceil(ms / 520), direction: 'alternate' });
      this.body.style.transformOrigin = '150px 320px';
      sway.finished.then(() => { if (this.state !== 'talking') this.setStatus(this.stream ? 'Pip is listening…' : 'Tap the microphone and talk to Pip'); });
    }
    async sayText() {
      if (!android.tts.available()) return ui.toast('Text-to-speech is not available');
      ui.prompt({ title: 'What should Pip say?', placeholder: 'Hello!', onOk: async text => {
        if (!text) return;
        this.stopMic();
        this.setStatus('“' + text + '”');
        this.mouthT && clearTimeout(this.mouthT);
        const wob = setInterval(() => { this.mouthLevel = 0.2 + Math.random() * 0.6; }, 90);
        try { await android.tts.speak(text, { pitch: 200, rate: 110 }); } catch (e) { ui.toast(e.message); }
        clearInterval(wob); this.mouthLevel = 0;
      } });
    }

    // ------------------------------------------------------------ listen & repeat
    async toggleMic() { if (this.stream) this.stopMic(); else await this.startMic(); }
    async startMic() {
      const c = this.ctx(); if (!c) return ui.toast('Web Audio unavailable');
      try { this.stream = await android.media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
      catch (e) { this.setStatus('Microphone unavailable: ' + (e.message || e.name)); return; }
      this.micBtn.classList.add('on');
      this.src = c.createMediaStreamSource(this.stream);
      this.proc = c.createScriptProcessor(2048, 1, 1);
      this.src.connect(this.proc); this.proc.connect(c.destination);
      let recording = [], speaking = false, silentSince = 0, noiseFloor = 0.01;
      this.setStatus('Pip is listening…'); this.ears(true);
      this.proc.onaudioprocess = ev => {
        const inp = ev.inputBuffer.getChannelData(0);
        ev.outputBuffer.getChannelData(0).fill(0);
        if (this.state === 'talking') return;
        let rms = 0; for (const v of inp) rms += v * v; rms = Math.sqrt(rms / inp.length);
        if (!speaking) noiseFloor = noiseFloor * 0.95 + rms * 0.05;
        const loud = rms > Math.max(0.02, noiseFloor * 3);
        if (loud) { if (!speaking) { speaking = true; recording = []; this.setStatus('…'); } silentSince = 0; }
        if (speaking) {
          recording.push(new Float32Array(inp));
          if (!loud) { silentSince = silentSince || performance.now(); if (performance.now() - silentSince > 700 || recording.length > c.sampleRate * 8 / 2048) { speaking = false; this.repeat(recording, c.sampleRate); recording = []; } }
        }
      };
    }
    stopMic() {
      if (this.proc) { this.proc.onaudioprocess = null; try { this.proc.disconnect(); this.src.disconnect(); } catch {} }
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      this.stream = this.proc = this.src = null;
      this.micBtn && this.micBtn.classList.remove('on');
      this.ears(false);
      if (this.state !== 'talking') this.setStatus('Tap the microphone and talk to Pip');
    }
    repeat(chunks, rate) {
      const c = this.ctx();
      const len = chunks.reduce((s, ch) => s + ch.length, 0);
      if (len < rate * 0.25) return;
      const buf = c.createBuffer(1, len, rate), d = buf.getChannelData(0);
      let o = 0, peak = 0; for (const ch of chunks) { d.set(ch, o); o += ch.length; }
      for (const v of d) peak = Math.max(peak, Math.abs(v));
      const s = c.createBufferSource(); s.buffer = buf;
      s.playbackRate.value = 1.55; // the classic squeaky-voice effect
      const g = c.createGain(); g.gain.value = Math.min(4, 0.8 / Math.max(peak, 0.05)) * Math.max(0.2, android.sound.mediaVolume());
      this.outAnalyser = c.createAnalyser(); this.outAnalyser.fftSize = 512;
      s.connect(g).connect(this.outAnalyser).connect(c.destination);
      this.state = 'talking'; this.ears(false); this.setStatus('Pip says…');
      s.onended = () => { this.state = 'idle'; this.outAnalyser = null; if (this.stream) { this.ears(true); this.setStatus('Pip is listening…'); } else this.setStatus('Tap the microphone and talk to Pip'); };
      s.start();
    }
  };
}
