// packages/apps/Dialer + InCallUI. Calls are simulated: ring-back tone, then an
// announcement synthesized by the Pico TTS engine (WebAssembly).
import { h, icon, letterTile, tileColor } from '../core/dom.js';
import { App, registerApp, sys } from '../core/system.js';
import { db } from '../core/db.js';
import { nm } from '../core/notifications.js';
import { dtmf, ringback, click } from '../core/sound.js';
import { speak, stopSpeaking, ttsAvailable } from '../core/tts.js';
import { toolbar, listItem, tabs, fab, toast, emptyState } from '../core/ui.js';
import { getContacts } from './contacts.js';

class Dialer extends App {
  onCreate(root, intent) {
    this.root = root;
    this.digits = h('input.dp-digits', { type: 'tel', placeholder: '', oninput: () => this.onDigits() });
    const letters = ['', '', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ'];
    const key = d => h('button.dp-key.rip.rip-u', { onclick: () => { dtmf(d); this.digits.value += d; this.onDigits(); } }, h('div.dk-d', d), h('div.dk-l', d === '0' ? '+' : d === '*' || d === '#' ? '' : letters[d]));
    this.suggest = h('div.dp-suggest');
    this.pad = h('div.dialpad', null,
      h('div.dp-top', this.digits, h('button.tb-btn.rip.rip-u', { onclick: () => { this.digits.value = this.digits.value.slice(0, -1); this.onDigits(); } }, icon('backspace'))),
      this.suggest,
      h('div.dp-keys', null, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(key)),
      h('div.dp-call', h('button.call-btn.rip.rip-u', { onclick: () => this.digits.value && this.call(this.digits.value) }, icon('phone'))));
    this.lists = [h('div.page-content.speed-dial'), h('div.page-content.call-log'), h('div.page-content.all-contacts')];
    const tb = tabs(['SPEED DIAL', 'RECENTS', 'CONTACTS'], i => this.showTab(i));
    this.fab = fab('dialpad', () => this.showPad(true));
    root.append(h('div.dialer', null, h('div.dialer-head', h('div.search-wrap.dialer-search', icon('search'), h('input', { placeholder: 'Search contacts & places', oninput: e => this.searchContacts(e.target.value) })), tb),
      ...this.lists, this.fab, this.pad));
    tb.select(0, true); this.showTab(0);
    if (intent.call) this.call(intent.call, intent.name);
  }
  onNewIntent(intent) { if (intent.call) this.call(intent.call, intent.name); }
  onBack() { if (this.pad.classList.contains('open')) { this.showPad(false); return true; } return false; }
  showPad(v) { this.pad.classList.toggle('open', v); this.fab.hidden = v; if (v) setTimeout(() => this.digits.focus(), 200); }
  async onDigits() {
    const q = this.digits.value.replace(/\D/g, '');
    this.suggest.innerHTML = '';
    if (!q) return;
    (await getContacts()).filter(c => (c.phone || '').replace(/\D/g, '').includes(q)).slice(0, 2).forEach(c => this.suggest.append(listItem({ avatar: letterTile(c.name, 32), title: c.name, summary: c.phone, onClick: () => this.call(c.phone, c.name) })));
  }
  async showTab(i) {
    this.lists.forEach((l, j) => { l.hidden = i !== j; });
    const el = this.lists[i]; el.innerHTML = '';
    const contacts = await getContacts();
    if (i === 0) {
      const favs = contacts.filter(c => c.starred);
      if (!favs.length) el.append(emptyState('star', 'No speed dial contacts yet'));
      el.append(h('div.speed-grid', null, favs.map(c => h('div.fav-tile.rip', { style: { background: tileColor(c.name) }, onclick: () => this.call(c.phone, c.name) }, h('div.fav-letter', c.name[0]), h('div.fav-name', c.name)))));
    } else if (i === 1) {
      const calls = (await db.all('calls')).sort((a, b) => b.date - a.date);
      if (!calls.length) el.append(emptyState('history', 'Your call log is empty'));
      calls.forEach(c => el.append(listItem({ avatar: letterTile(c.name || c.number), title: c.name || c.number, summary: `↗ ${new Date(c.date).toLocaleString()} · ${c.duration}s`, onClick: () => this.call(c.number, c.name), widget: h('span.tb-btn', icon('phone')) })));
    } else this.renderContacts(el, contacts);
  }
  renderContacts(el, list) { list.forEach(c => el.append(listItem({ avatar: letterTile(c.name), title: c.name, summary: c.phone, onClick: () => this.call(c.phone, c.name) }))); }
  async searchContacts(q) { this.showTab(2); const el = this.lists[2]; el.innerHTML = ''; this.renderContacts(el, (await getContacts()).filter(c => c.name.toLowerCase().includes(q.toLowerCase()) || (c.phone || '').includes(q))); }

  async call(number, name) {
    if (!name) { const c = (await getContacts()).find(c => (c.phone || '').replace(/\D/g, '') === number.replace(/\D/g, '')); name = c && c.name; }
    this.showPad(false);
    const status = h('div.ic-status', 'Dialing');
    const timer = h('div.ic-timer');
    const color = tileColor(name || number);
    let ended = false, start = 0, tick, rb;
    const end = async () => {
      if (ended) return; ended = true;
      rb && rb.stop(); stopSpeaking(); clearInterval(tick); nm.cancel('call');
      status.textContent = 'Call ended';
      await db.put('calls', { number, name, date: Date.now(), duration: start ? Math.round((Date.now() - start) / 1000) : 0 });
      this.setFullscreen(false);
      setTimeout(() => { ui.remove(); this.setStatusBarColor(this.manifest.colorDark); this.showTab(1); }, 900);
    };
    const btn = (ic, label, fn) => h('button.ic-btn.rip.rip-u', { onclick: e => { click(); e.currentTarget.classList.toggle('on'); fn && fn(); } }, icon(ic), h('span', label));
    const ui = h('div.incall', null,
      h('div.ic-top', { style: { background: color } }, h('div.ic-name', name || number), name ? h('div.ic-number', number) : null, status, timer),
      h('div.ic-photo', { style: { background: color } }, h('div.ic-letter', (name || '#')[0])),
      h('div.ic-buttons', btn('volume', 'Speaker'), btn('silent', 'Mute'), btn('dialpad', 'Dialpad'), btn('pause', 'Hold')),
      h('div.ic-end', h('button.end-btn.rip.rip-u', { onclick: end }, icon('callEnd'))));
    this.root.append(ui);
    this.setStatusBarColor(color);
    nm.notify({ id: 'call', appId: 'phone', smallIcon: 'mdi:phone', ongoing: true, silent: true, title: 'Ongoing call', text: name || number, color: '#0f9d58', actions: [{ label: 'Hang up', onClick: end }] });
    rb = ringback();
    await new Promise(r => setTimeout(r, 4500));
    if (ended) return;
    rb.stop();
    status.textContent = 'Connected';
    start = Date.now();
    tick = setInterval(() => { const s = Math.round((Date.now() - start) / 1000); timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 500);
    if (ttsAvailable()) {
      const spoken = number.replace(/\D/g, '').split('').join(' ');
      try { await speak(`The number ${spoken} cannot be reached, because this phone is running inside a web browser. Please hang up and try again from a real phone.`); } catch {}
      setTimeout(end, 800);
    } else setTimeout(end, 4000);
  }
}
registerApp({ id: 'phone', label: 'Phone', icon: 'phone', color: '#0288d1', colorDark: '#0277bd', accent: '#0288d1', pkg: 'com.android.dialer', stores: ['calls'] }, Dialer);
