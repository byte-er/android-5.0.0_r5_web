// packages/apps/SoundRecorder - MediaRecorder + AnalyserNode VU meter.
import { h, icon } from '../core/dom.js';
import { App, registerApp } from '../core/system.js';
import { db } from '../core/db.js';
import { audioCtx } from '../core/sound.js';
import { toolbar, listItem, toast, emptyState } from '../core/ui.js';

class Recorder extends App {
  onCreate(root) {
    this.time = h('div.rec-time', '00:00');
    this.meter = h('canvas.rec-meter', { width: 600, height: 300 });
    this.btn = h('button.rec-btn.rip.rip-u', { onclick: () => this.toggle(), 'aria-label': 'Record' }, h('span.rec-dot'));
    this.list = h('div.rec-list');
    root.append(h('div.recorder', null, toolbar({ title: 'Sound Recorder' }), h('div.rec-main', this.meter, this.time, this.btn), h('div.page-content', this.list)));
    this.drawMeter(0);
    this.renderList();
  }
  onDestroy() { this.stop(); }
  async toggle() {
    if (this.rec) return this.stop();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) { return toast('Microphone unavailable: ' + (e.message || e.name)); }
    const c = audioCtx();
    const src = c.createMediaStreamSource(this.stream);
    this.an = c.createAnalyser(); this.an.fftSize = 1024; src.connect(this.an);
    const chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = e => chunks.push(e.data);
    this.rec.onstop = async () => {
      const blob = new Blob(chunks, { type: this.rec?.mimeType || 'audio/webm' });
      const dur = Math.round((Date.now() - this.t0) / 1000);
      await db.put('recordings', { blob, date: Date.now(), duration: dur, name: 'Recording ' + new Date().toLocaleString() });
      this.rec = null; this.renderList(); toast('Recording saved');
    };
    this.rec.start(); this.t0 = Date.now();
    this.btn.classList.add('recording');
    const buf = new Uint8Array(this.an.fftSize);
    const loop = () => {
      if (!this.rec) return;
      this.an.getByteTimeDomainData(buf);
      let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
      this.drawMeter(peak);
      const s = Math.floor((Date.now() - this.t0) / 1000);
      this.time.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }
  stop() {
    cancelAnimationFrame(this.raf);
    if (this.rec && this.rec.state === 'recording') this.rec.stop();
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null; this.btn?.classList.remove('recording'); this.drawMeter(0);
  }
  drawMeter(v) {
    // the classic SoundRecorder VU meter: an arc with a needle
    const g = this.meter.getContext('2d'); g.clearRect(0, 0, 600, 300);
    g.strokeStyle = '#bdbdbd'; g.lineWidth = 6; g.beginPath(); g.arc(300, 290, 240, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    g.strokeStyle = '#e53935'; g.beginPath(); g.arc(300, 290, 240, Math.PI * 1.7, Math.PI * 1.85); g.stroke();
    const a = Math.PI * (1.15 + 0.7 * Math.min(1, v * 1.5));
    g.strokeStyle = '#424242'; g.lineWidth = 5; g.beginPath(); g.moveTo(300, 290); g.lineTo(300 + Math.cos(a) * 250, 290 + Math.sin(a) * 250); g.stroke();
  }
  async renderList() {
    const recs = (await db.all('recordings')).sort((a, b) => b.date - a.date);
    this.list.innerHTML = '';
    if (!recs.length) this.list.append(emptyState('mic', 'No recordings'));
    for (const r of recs) {
      const audio = h('audio', { src: URL.createObjectURL(r.blob) });
      const play = h('button.tb-btn.rip.rip-u', { onclick: e => { e.stopPropagation(); audio.paused ? audio.play() : audio.pause(); } }, icon('play'));
      audio.onplay = () => { play.innerHTML = ''; play.append(icon('pause')); }; audio.onpause = audio.onended = () => { play.innerHTML = ''; play.append(icon('play')); };
      this.list.append(listItem({ icon: 'mic', title: r.name, summary: `${r.duration}s`, widget: h('div.row', play, h('button.tb-btn.rip.rip-u', { onclick: async e => { e.stopPropagation(); await db.del('recordings', r.id); this.renderList(); } }, icon('delete'))) }));
    }
  }
}
registerApp({ id: 'recorder', label: 'Sound Recorder', icon: 'recorder', color: '#424242', colorDark: '#212121', accent: '#e53935', pkg: 'com.android.soundrecorder', permissions: ['Microphone'], stores: ['recordings'] }, Recorder);
