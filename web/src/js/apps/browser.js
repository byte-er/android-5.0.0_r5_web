// packages/apps/Browser - a tabbed browser around <iframe>.
import { h, icon } from '../core/dom.js';
import { App, registerApp } from '../core/system.js';
import { toolbar, toast, popupMenu, listItem, dialog } from '../core/ui.js';

const BOOKMARKS = [
  ['Wikipedia', 'https://en.m.wikipedia.org/wiki/Android_Lollipop'],
  ['OpenStreetMap', 'https://www.openstreetmap.org/export/embed.html?bbox=-122.10,37.40,-122.06,37.43&layer=mapnik'],
  ['Example Domain', 'https://example.com/'],
  ['AOSP source (Gitiles)', 'https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-5.0.0_r5'],
];
const HIST = 'android5web.browser.history';

class Browser extends App {
  onCreate(root, intent) {
    this.url = h('input.url-field', { type: 'url', placeholder: 'Search or type URL', spellcheck: false, autocapitalize: 'off' });
    this.progress = h('div.br-progress');
    this.frames = h('div.br-frames');
    this.tabs = []; this.cur = null;
    this.url.addEventListener('keydown', e => { if (e.key === 'Enter') { this.go(this.url.value); this.url.blur(); } });
    this.url.addEventListener('focus', () => this.url.select());
    const bar = h('div.br-bar', null, this.url,
      h('button.tb-btn.rip.rip-u', { title: 'Tabs', onclick: () => this.showTabs() }, h('span.tab-count', '1')),
      h('button.tb-btn.rip.rip-u', { title: 'More', onclick: e => popupMenu(e.currentTarget, [
        { label: 'New tab', onClick: () => this.newTab() }, { label: 'Refresh', onClick: () => this.reload() },
        { label: 'Bookmarks', onClick: () => this.showHome() }, { label: 'History', onClick: () => this.showHistory() },
        { label: 'Open in a real browser tab', onClick: () => this.cur?.src && window.open(this.cur.src, '_blank', 'noopener') },
        { label: 'Share page', onClick: () => navigator.share ? navigator.share({ url: this.cur?.src }).catch(() => {}) : toast('Sharing not supported') }]) }, icon('more')));
    root.append(h('div.browser', null, bar, this.progress, this.frames));
    this.newTab();
    if (intent.url) this.go(intent.url);
    if (intent.focusUrl) setTimeout(() => this.url.focus(), 350);
  }
  onNewIntent(intent) { if (intent.url) this.go(intent.url); if (intent.focusUrl) this.url.focus(); }
  onBack() {
    if (this.cur && this.cur.hist.length > 1) { this.cur.hist.pop(); this.load(this.cur.hist[this.cur.hist.length - 1], false); return true; }
    if (this.cur && this.cur.src) { this.cur.hist = []; this.showHome(); return true; }
    return false;
  }
  newTab() {
    const t = { el: h('div.br-tab'), hist: [], src: '' };
    this.tabs.push(t); this.frames.append(t.el); this.select(t); this.showHome();
    this.task.el.querySelector('.tab-count').textContent = this.tabs.length;
  }
  select(t) { this.cur = t; this.tabs.forEach(x => { x.el.hidden = x !== t; }); this.url.value = t.src || ''; }
  showHome() {
    const t = this.cur; t.src = ''; this.url.value = '';
    t.el.innerHTML = '';
    t.el.append(h('div.br-home', null, h('div.br-home-title', 'Bookmarks'), h('div.br-bookmarks', null, BOOKMARKS.map(([n, u]) =>
      h('div.br-bm.rip', { onclick: () => this.go(u) }, h('div.br-bm-thumb', n[0]), h('div.br-bm-name', n)))),
      h('p.br-note', 'Pages load inside an <iframe>. Sites that forbid embedding (X-Frame-Options / CSP frame-ancestors) will stay blank: use "Open in a real browser tab" from the menu.')));
  }
  go(text) {
    text = (text || '').trim(); if (!text) return;
    let u = text;
    if (!/^[a-z]+:\/\//i.test(u)) u = /^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(u) ? 'https://' + u : 'https://en.m.wikipedia.org/w/index.php?search=' + encodeURIComponent(text);
    this.load(u, true);
  }
  load(u, push) {
    const t = this.cur;
    t.src = u; this.url.value = u;
    if (push) t.hist.push(u);
    try { const hist = JSON.parse(localStorage.getItem(HIST) || '[]'); hist.unshift({ u, t: Date.now() }); localStorage.setItem(HIST, JSON.stringify(hist.slice(0, 50))); } catch {}
    t.el.innerHTML = '';
    const f = h('iframe.br-frame', { src: u, referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups' });
    this.progress.className = 'br-progress loading';
    f.addEventListener('load', () => { this.progress.className = 'br-progress done'; setTimeout(() => { this.progress.className = 'br-progress'; }, 400); });
    t.el.append(f);
  }
  reload() { if (this.cur.src) this.load(this.cur.src, false); }
  showTabs() {
    dialog({ title: 'Tabs', items: this.tabs.map((t, i) => ({ label: (t.src || 'Bookmarks').replace(/^https?:\/\//, '').slice(0, 40), onClick: () => this.select(t) })).concat([{ label: '+ New tab', onClick: () => this.newTab() }]), buttons: [{ label: 'Close' }] });
  }
  showHistory() {
    let hist = []; try { hist = JSON.parse(localStorage.getItem(HIST) || '[]'); } catch {}
    dialog({ title: 'History', items: hist.slice(0, 15).map(x => ({ label: x.u.replace(/^https?:\/\//, '').slice(0, 44), onClick: () => this.go(x.u) })), buttons: [{ label: 'Clear', onClick: () => localStorage.removeItem(HIST) }, { label: 'Close' }] });
  }
}
registerApp({ id: 'browser', label: 'Browser', icon: 'browser', color: '#eeeeee', colorDark: '#9e9e9e', accent: '#4285f4', pkg: 'com.android.browser', permissions: ['Internet'] }, Browser);
