// packages/apps/Camera2 - getUserMedia viewfinder, photo + video capture into the media store.
import { h, icon } from '../core/dom.js';
import { App, registerApp, sys } from '../core/system.js';
import { db } from '../core/db.js';
import { playEffect } from '../core/sound.js';
import { toast } from '../core/ui.js';

class Camera extends App {
  onCreate(root) {
    this.facing = 'environment'; this.mode = 'photo';
    this.video = h('video.cam-view', { autoplay: true, playsinline: true, muted: true });
    this.flash = h('div.cam-flash');
    this.thumb = h('button.cam-thumb.rip.rip-u', { onclick: () => sys.launch('gallery', { album: 'Camera' }) });
    this.shutter = h('button.cam-shutter', { onclick: () => this.capture(), 'aria-label': 'Shutter' });
    this.modeBtn = h('button.cam-mode.rip.rip-u', { onclick: () => this.toggleMode(), title: 'Photo / Video' }, icon('video'));
    this.timer = h('div.cam-rec-time');
    this.msg = h('div.cam-msg');
    root.append(h('div.camera', null, this.video, this.flash, this.msg, this.timer,
      h('div.cam-top', h('button.tb-btn.rip.rip-u', { onclick: () => this.switchCam(), title: 'Switch camera' }, icon('switchCam'))),
      h('div.cam-bottom', this.thumb, this.shutter, this.modeBtn)));
    this.refreshThumb();
  }
  async onResume() { await this.start(); }
  onPause() { this.stop(); }
  onDestroy() { this.stop(); }
  async start() {
    this.stop();
    this.msg.textContent = '';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: this.mode === 'video' });
      this.video.srcObject = this.stream;
      this.video.classList.toggle('mirror', this.facing === 'user');
    } catch (e) { this.msg.textContent = 'Can’t connect to the camera.\n' + (e.message || e.name); }
  }
  stop() { if (this.rec && this.rec.state === 'recording') this.rec.stop(); if (this.stream) this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
  switchCam() { this.facing = this.facing === 'user' ? 'environment' : 'user'; this.start(); }
  toggleMode() {
    this.mode = this.mode === 'photo' ? 'video' : 'photo';
    this.modeBtn.innerHTML = ''; this.modeBtn.append(icon(this.mode === 'photo' ? 'video' : 'camera'));
    this.shutter.classList.toggle('video', this.mode === 'video');
    this.start();
  }
  async capture() {
    if (!this.stream) return toast('Camera unavailable');
    if (this.mode === 'video') return this.toggleRecord();
    playEffect('camera_click', 'system', 0.7);
    this.flash.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 300 });
    const v = this.video, c = h('canvas', { width: v.videoWidth, height: v.videoHeight });
    const g = c.getContext('2d');
    if (this.facing === 'user') { g.translate(c.width, 0); g.scale(-1, 1); }
    g.drawImage(v, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    await db.put('media', { type: 'image', blob, date: Date.now(), album: 'Camera', w: c.width, h: c.height });
    this.refreshThumb();
  }
  toggleRecord() {
    if (this.rec && this.rec.state === 'recording') { this.rec.stop(); return; }
    if (!window.MediaRecorder) return toast('Video recording not supported');
    const chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = e => chunks.push(e.data);
    this.rec.onstop = async () => {
      clearInterval(this.recTimer); this.timer.textContent = ''; this.shutter.classList.remove('recording'); playEffect('VideoStop', 'system', 0.5);
      const blob = new Blob(chunks, { type: this.rec.mimeType || 'video/webm' });
      await db.put('media', { type: 'video', blob, date: Date.now(), album: 'Camera' });
      this.refreshThumb();
    };
    playEffect('VideoRecord', 'system', 0.5);
    this.rec.start(); this.shutter.classList.add('recording');
    const t0 = Date.now();
    this.recTimer = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); this.timer.textContent = `● ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 250);
  }
  async refreshThumb() {
    const all = (await db.all('media')).filter(m => m.album === 'Camera').sort((a, b) => b.date - a.date);
    this.thumb.innerHTML = '';
    if (all[0] && all[0].type === 'image') this.thumb.append(h('img', { src: URL.createObjectURL(all[0].blob) }));
    else if (all[0]) this.thumb.append(icon('video'));
  }
}
registerApp({ id: 'camera', label: 'Camera', icon: 'camera', color: '#000', colorDark: '#000', fullscreen: true, pkg: 'com.android.camera2', permissions: ['Camera', 'Microphone'], stores: ['media'] }, Camera);
