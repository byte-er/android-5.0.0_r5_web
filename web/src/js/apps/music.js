// packages/apps/Music - plays the AOSP Material sound set and local audio files.
import { h, icon } from '../core/dom.js';
import { App, registerApp, sys } from '../core/system.js';
import { asset, listAssets } from '../core/assets.js';
import { prefs } from '../core/prefs.js';
import { nm } from '../core/notifications.js';
import { toolbar, listItem, slider, tabs, toast } from '../core/ui.js';
import { renderMidi, midiAvailable } from '../core/midi.js';
import { fetchBytes } from '../core/assets.js';

const ALBUMS = { ringtones: 'Material Ringtones', notifications: 'Material Notifications', alarms: 'Material Alarms', midi: 'MIDI (Sonivox EAS)' };
const ART = { midi: ['#8bc34a', '#00796b'], ringtones: ['#e91e63', '#9c27b0'], notifications: ['#00bcd4', '#3f51b5'], alarms: ['#ff9800', '#f44336'], local: ['#607d8b', '#263238'] };

class Music extends App {
  onCreate(root) {
    this.tracks = listAssets('sound/').filter(k => /^sound\/(ringtones|notifications|alarms)\//.test(k)).map(k => {
      const [, kind, f] = k.split('/');
      return { title: f.replace('.ogg', ''), album: ALBUMS[kind], kind, artist: 'Android Open Source Project', src: asset(k) };
    });
    if (midiAvailable()) this.tracks.unshift(...listAssets('midi/').map(k => ({ title: k.split('/').pop().replace(/\.[^.]+$/, ''), album: ALBUMS.midi, kind: 'midi', artist: 'Sonivox EAS synthesizer (WebAssembly)', midiKey: k })));
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.idx = -1;
    this.list = h('div.page-content.track-list');
    this.mini = h('div.mini-player.rip', { onclick: () => this.full.classList.add('open') });
    this.full = this.fullPlayer();
    const tb = tabs(['ALL', 'MIDI', 'RINGTONES', 'NOTIF.', 'ALARMS'], i => { this.filter = [null, 'midi', 'ringtones', 'notifications', 'alarms'][i]; this.renderList(); });
    root.append(h('div.music', null, h('div.music-head', toolbar({ title: 'Music', menu: [{ label: 'Open audio files…', onClick: () => this.openFiles() }, { label: 'Shuffle all', onClick: () => { this.shuffle = true; this.play(Math.floor(Math.random() * this.tracks.length)); } }] }), tb), this.list, this.mini, this.full));
    tb.select(0, true);
    this.audio.addEventListener('timeupdate', () => this.updateProgress());
    this.audio.addEventListener('ended', () => this.next());
    this.audio.addEventListener('play', () => this.updateState());
    this.audio.addEventListener('pause', () => this.updateState());
    this.volListener = prefs.on('vol_media', v => { this.audio.volume = v; });
    this.audio.volume = prefs.get('vol_media');
    this.renderList(); this.updateState();
  }
  onDestroy() { this.audio.pause(); this.audio.src = ''; nm.cancel('music'); sys.mediaPlaying = false; prefs.off('vol_media', this.volListener); }
  onBack() { if (this.full.classList.contains('open')) { this.full.classList.remove('open'); return true; } return false; }
  renderList() {
    this.list.innerHTML = '';
    this.tracks.forEach((t, i) => {
      if (this.filter && t.kind !== this.filter) return;
      const art = h('div.track-art', { style: { background: `linear-gradient(135deg, ${ART[t.kind][0]}, ${ART[t.kind][1]})` } }, icon('music'));
      const li = listItem({ avatar: art, title: t.title, summary: `${t.artist} · ${t.album}`, onClick: () => this.play(i), cls: i === this.idx ? 'playing' : '' });
      this.list.append(li);
    });
  }
  fullPlayer() {
    this.artBig = h('div.fp-art', icon('music'));
    this.fpTitle = h('div.fp-title'); this.fpArtist = h('div.fp-artist');
    this.seek = slider(0, v => { if (this.audio.duration) this.audio.currentTime = v * this.audio.duration; });
    this.tCur = h('span'); this.tDur = h('span');
    this.playBtn = h('button.fp-play.rip.rip-u', { onclick: () => this.toggle() }, icon('play'));
    return h('div.full-player', null,
      toolbar({ title: 'Now playing', back: () => this.full.classList.remove('open'), cls: 'transparent' }),
      this.artBig, h('div.fp-info', this.fpTitle, this.fpArtist),
      h('div.fp-seek', this.seek, h('div.fp-times', this.tCur, this.tDur)),
      h('div.fp-controls',
        h('button.tb-btn.rip.rip-u', { onclick: e => { this.shuffle = !this.shuffle; e.currentTarget.classList.toggle('on', this.shuffle); } }, icon('shuffle')),
        h('button.tb-btn.rip.rip-u', { onclick: () => this.prev() }, icon('prev')), this.playBtn,
        h('button.tb-btn.rip.rip-u', { onclick: () => this.next() }, icon('next')),
        h('button.tb-btn.rip.rip-u', { onclick: e => { this.repeat = !this.repeat; e.currentTarget.classList.toggle('on', this.repeat); } }, icon('repeat'))));
  }
  async play(i) {
    if (!this.tracks[i]) return;
    this.idx = i;
    const t = this.tracks[i];
    if (!t.src && (t.midiKey || t.midiFile)) {
      toast('Synthesizing with Sonivox EAS…');
      try {
        const r = await renderMidi(t.midiFile ? await t.midiFile.arrayBuffer() : await fetchBytes(t.midiKey));
        t.src = URL.createObjectURL(r.blob);
        toast(`Rendered ${r.seconds.toFixed(1)} s of MIDI in ${Math.round(r.ms)} ms (WebAssembly)`);
      } catch (e) { toast('Can\u2019t play this file: ' + e.message); return; }
      if (this.idx !== i) return;
    }
    this.audio.src = t.src;
    this.audio.play().catch(() => toast('Can’t play this file'));
    this.renderList();
  }
  toggle() { if (this.idx < 0) return this.play(0); this.audio.paused ? this.audio.play() : this.audio.pause(); }
  next() { if (this.repeat && this.idx >= 0) return this.play(this.idx); this.play(this.shuffle ? Math.floor(Math.random() * this.tracks.length) : (this.idx + 1) % this.tracks.length); }
  prev() { if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; } this.play((this.idx - 1 + this.tracks.length) % this.tracks.length); }
  updateProgress() {
    const d = this.audio.duration || 0, c = this.audio.currentTime || 0;
    this.seek.set(d ? c / d : 0);
    const f = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    this.tCur.textContent = f(c); this.tDur.textContent = f(d);
  }
  updateState() {
    const t = this.tracks[this.idx];
    const playing = !this.audio.paused;
    sys.mediaPlaying = playing;
    this.playBtn.innerHTML = ''; this.playBtn.append(icon(playing ? 'pause' : 'play'));
    this.mini.innerHTML = '';
    this.mini.hidden = !t;
    if (!t) return;
    const grad = `linear-gradient(135deg, ${ART[t.kind][0]}, ${ART[t.kind][1]})`;
    this.artBig.style.background = grad;
    this.fpTitle.textContent = t.title; this.fpArtist.textContent = `${t.artist} · ${t.album}`;
    this.mini.append(h('div.track-art', { style: { background: grad } }, icon('music')), h('div.mini-text', h('div', t.title), h('small', t.artist)),
      h('button.tb-btn.rip.rip-u', { onclick: e => { e.stopPropagation(); this.toggle(); } }, icon(playing ? 'pause' : 'play')));
    nm.notify({ id: 'music', appId: 'music', smallIcon: 'mdi:music', ongoing: playing, silent: true, title: t.title, text: t.artist, color: ART[t.kind][0],
      actions: [{ icon: 'prev', onClick: () => this.prev() }, { icon: playing ? 'pause' : 'play', onClick: () => this.toggle() }, { icon: 'next', onClick: () => this.next() }] });
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album });
        navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
      } catch {}
    }
  }
  openFiles() {
    const inp = h('input', { type: 'file', accept: 'audio/*', multiple: true });
    inp.accept = 'audio/*,.mid,.midi,.xmf,.mxmf,.rtttl,.imy,.ota';
    inp.onchange = () => {
      for (const f of inp.files) {
        const isMidi = /\.(mid|midi|xmf|mxmf|rtttl|rtx|imy|ota)$/i.test(f.name);
        this.tracks.unshift({ title: f.name.replace(/\.[^.]+$/, ''), album: isMidi ? ALBUMS.midi : 'Local files', artist: isMidi ? 'Sonivox EAS synthesizer (WebAssembly)' : 'Unknown artist', kind: isMidi ? 'midi' : 'local', src: isMidi ? null : URL.createObjectURL(f), midiFile: isMidi ? f : null });
      }
      this.idx = -1; this.renderList(); this.play(0);
    };
    inp.click();
  }
}
registerApp({ id: 'music', label: 'Music', icon: 'music', color: '#ff5722', colorDark: '#e64a19', accent: '#ff5722', pkg: 'com.android.music' }, Music);
