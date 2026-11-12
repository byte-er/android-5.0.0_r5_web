// Swift Browser: a lightweight tabbed browser for Android 5.0 for the web.
// Original web implementation; packaged with apk2wapk as the replacement for
// the Opera Mini APK (whose Dalvik/ARM code cannot run in a browser).
export default function createApp(android) {
  const { App, h, icon, ui, onLongPress } = android;
  const P = android.prefs;
  const DEFAULT_DIAL = [
    ['Wikipedia', 'https://en.m.wikipedia.org/'], ['OpenStreetMap', 'https://www.openstreetmap.org/export/embed.html?bbox=-0.15,51.49,-0.10,51.52&layer=mapnik'],
    ['Example', 'https://example.com/'], ['AOSP', 'https://android.googlesource.com/'],
  ];
  const ENGINES = { wikipedia: ['Wikipedia', 'https://en.m.wikipedia.org/w/index.php?search='], wiktionary: ['Wiktionary', 'https://en.m.wiktionary.org/w/index.php?search='] };
  const DIAL_COLORS = ['#e53935', '#8e24aa', '#3949ab', '#039be5', '#00897b', '#7cb342', '#fb8c00', '#6d4c41'];
  const colorFor = s => DIAL_COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % DIAL_COLORS.length];
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

  return class SwiftBrowser extends App {
    onCreate(root) {
      this.tabs = []; this.cur = null;
      this.url = h('input.sb-url', { type: 'url', placeholder: 'Search or enter address', spellcheck: false, autocapitalize: 'off' });
      this.url.addEventListener('keydown', e => { if (e.key === 'Enter') { this.go(this.url.value); this.url.blur(); } });
      this.url.addEventListener('focus', () => this.url.select());
      this.lock = h('span.sb-lock');
      this.frames = h('div.sb-frames');
      this.progress = h('div.sb-progress');
      this.count = h('span.sb-count', '1');
      const btn = (ic, title, fn) => h('button.tb-btn.rip.rip-u', { title, onclick: fn }, icon(ic));
      this.backBtn = btn('back', 'Back', () => this.back());
      this.fwdBtn = btn('forward', 'Forward', () => this.forward());
      this.el = h('div.sb', null,
        h('div.sb-top', this.lock, this.url, btn('refresh', 'Reload', () => this.reload())), this.progress, this.frames,
        h('div.sb-bottom', this.backBtn, this.fwdBtn, btn('dialpad', 'Speed Dial', () => this.showDial()),
          h('button.tb-btn.rip.rip-u', { title: 'Tabs', onclick: () => this.showTabs() }, this.count),
          btn('more', 'Menu', e => this.menu(e.currentTarget))));
      root.append(this.el);
      this.applyNight();
      this.newTab(false);
    }
    onBack() {
      if (this.el.querySelector('.sb-tabgrid')) { this.el.querySelector('.sb-tabgrid').remove(); return true; }
      return this.back();
    }

    // ---------------------------------------------------------------- tabs
    newTab(priv) {
      const t = { el: h('div.sb-tab'), hist: [], pos: -1, priv, title: priv ? 'Private tab' : 'Speed Dial' };
      this.tabs.push(t); this.frames.append(t.el); this.select(t); this.showDial();
    }
    select(t) {
      this.cur = t;
      this.tabs.forEach(x => { x.el.hidden = x !== t; });
      this.url.value = t.hist[t.pos] || '';
      this.el.classList.toggle('private', !!t.priv);
      this.count.textContent = this.tabs.length;
      this.updateNav();
    }
    closeTab(t) {
      t.el.remove(); this.tabs.splice(this.tabs.indexOf(t), 1);
      if (!this.tabs.length) this.newTab(false); else if (this.cur === t) this.select(this.tabs[this.tabs.length - 1]);
      this.count.textContent = this.tabs.length;
    }
    showTabs() {
      const grid = h('div.sb-tabgrid', null,
        h('div.sb-tabbar', h('div', `${this.tabs.length} tab${this.tabs.length > 1 ? 's' : ''}`),
          ui.button('+ Tab', () => { grid.remove(); this.newTab(false); }), ui.button('+ Private', () => { grid.remove(); this.newTab(true); })),
        h('div.sb-tabcards', null, this.tabs.map(t => h('div.sb-tabcard.rip' + (t === this.cur ? '.current' : '') + (t.priv ? '.priv' : ''), { onclick: () => { grid.remove(); this.select(t); } },
          h('div.sb-tabhead', h('span', t.title || 'New tab'), h('button.tb-btn', { onclick: e => { e.stopPropagation(); this.closeTab(t); grid.remove(); this.showTabs(); } }, icon('close'))),
          h('div.sb-tabthumb', { style: { background: t.hist[t.pos] ? colorFor(host(t.hist[t.pos])) : '#eceff1' } }, t.hist[t.pos] ? host(t.hist[t.pos]) : 'Speed Dial')))));
      this.el.append(grid);
    }

    // ---------------------------------------------------------------- navigation
    go(text) {
      text = (text || '').trim(); if (!text) return;
      let u = text;
      if (!/^[a-z]+:\/\//i.test(u)) u = /^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(u) ? 'https://' + u : ENGINES[P.get('engine', 'wikipedia')][1] + encodeURIComponent(text);
      const t = this.cur;
      t.hist = t.hist.slice(0, t.pos + 1); t.hist.push(u); t.pos++;
      this.load(u);
    }
    load(u) {
      const t = this.cur;
      t.el.innerHTML = '';
      this.url.value = u; t.title = host(u);
      this.lock.innerHTML = ''; this.lock.append(icon(u.startsWith('https:') ? 'lock' : 'info'));
      const f = h('iframe.sb-frame', { src: u, referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups' });
      this.progress.className = 'sb-progress loading';
      f.addEventListener('load', () => { this.progress.className = 'sb-progress done'; setTimeout(() => { this.progress.className = 'sb-progress'; }, 400); });
      t.el.append(f);
      if (!t.priv) { const hist = P.get('history', []); hist.unshift({ u, t: Date.now() }); P.set('history', hist.slice(0, 100)); }
      this.updateNav();
    }
    back() { const t = this.cur; if (t.pos > 0) { t.pos--; this.load(t.hist[t.pos]); return true; } if (t.pos === 0) { t.pos = -1; this.showDial(); return true; } return false; }
    forward() { const t = this.cur; if (t.pos < t.hist.length - 1) { t.pos++; this.load(t.hist[t.pos]); } }
    reload() { const t = this.cur; if (t.pos >= 0) this.load(t.hist[t.pos]); }
    updateNav() { const t = this.cur; this.backBtn.disabled = t.pos < 0; this.fwdBtn.disabled = t.pos >= t.hist.length - 1; }

    // ---------------------------------------------------------------- speed dial
    showDial() {
      const t = this.cur;
      t.pos = -1;
      t.el.innerHTML = ''; this.url.value = ''; t.title = t.priv ? 'Private tab' : 'Speed Dial';
      this.lock.innerHTML = ''; this.lock.append(icon('search'));
      const dial = P.get('dial', DEFAULT_DIAL);
      const grid = h('div.sb-dialgrid', null, dial.map(([name, u], i) => {
        const tile = h('div.sb-dial.rip', { onclick: () => this.go(u) }, h('div.sb-dialicon', { style: { background: colorFor(name) } }, name[0].toUpperCase()), h('div.sb-dialname', name));
        onLongPress(tile, () => ui.dialog({ title: name, items: [{ label: 'Open in private tab', onClick: () => { this.newTab(true); this.go(u); } }, { label: 'Remove from Speed Dial', onClick: () => { dial.splice(i, 1); P.set('dial', dial); this.showDial(); } }] }));
        return tile;
      }), h('div.sb-dial.add.rip', { onclick: () => this.addDial() }, h('div.sb-dialicon', icon('add')), h('div.sb-dialname', 'Add site')));
      t.el.append(h('div.sb-home', null, t.priv ? h('div.sb-privnote', icon('lock'), 'Private tab: pages you visit won’t be saved to history.') : null, grid,
        h('p.sb-note', 'Pages load in an <iframe>; sites that forbid embedding stay blank. Use the menu to open them in a real browser tab.')));
      this.updateNav();
    }
    addDial() {
      const cur = this.cur.hist[this.cur.pos];
      ui.prompt({ title: 'Add to Speed Dial', value: cur || 'https://', onOk: v => {
        if (!v || v === 'https://') return;
        if (!/^[a-z]+:\/\//i.test(v)) v = 'https://' + v;
        const dial = P.get('dial', DEFAULT_DIAL); dial.push([host(v), v]); P.set('dial', dial);
        ui.toast('Added to Speed Dial'); if (this.cur.pos < 0) this.showDial();
      } });
    }

    // ---------------------------------------------------------------- menu
    menu(anchor) {
      const cur = this.cur.hist[this.cur.pos];
      ui.popupMenu(anchor, [
        { label: 'New tab', onClick: () => this.newTab(false) }, { label: 'New private tab', onClick: () => this.newTab(true) },
        cur ? { label: 'Add to Speed Dial', onClick: () => this.addDial() } : null,
        cur ? { label: 'Bookmark this page', onClick: () => { const b = P.get('bookmarks', []); b.unshift({ u: cur, title: host(cur) }); P.set('bookmarks', b); ui.toast('Bookmark saved'); } } : null,
        { label: 'Bookmarks', onClick: () => this.list('Bookmarks', P.get('bookmarks', []), 'bookmarks') },
        { label: 'History', onClick: () => this.list('History', P.get('history', []), 'history') },
        { label: P.get('night', false) ? 'Night mode: on' : 'Night mode: off', onClick: () => { P.set('night', !P.get('night', false)); this.applyNight(); } },
        { label: 'Search engine: ' + ENGINES[P.get('engine', 'wikipedia')][0], onClick: () => ui.dialog({ title: 'Search engine', items: Object.entries(ENGINES).map(([k, [n]]) => ({ label: n, onClick: () => P.set('engine', k) })) }) },
        cur ? { label: 'Share page', onClick: () => navigator.share ? navigator.share({ url: cur }).catch(() => {}) : ui.toast(cur) } : null,
        cur ? { label: 'Open in a real browser tab', onClick: () => window.open(cur, '_blank', 'noopener') } : null,
      ]);
    }
    list(title, items, key) {
      ui.dialog({ title, items: items.length ? items.slice(0, 20).map(x => ({ label: (x.title || host(x.u)) + '  ·  ' + x.u.replace(/^https?:\/\//, '').slice(0, 30), onClick: () => this.go(x.u) })) : [{ label: 'Nothing here yet' }],
        buttons: [{ label: 'Clear', onClick: () => { P.set(key, []); ui.toast(title + ' cleared'); } }, { label: 'Close' }] });
    }
    applyNight() { this.el.classList.toggle('night', !!P.get('night', false)); }
  };
}
