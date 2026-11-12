// packages/apps/Gallery2 - albums, grid and a swipeable photo viewer.
import { h, icon, drag } from '../core/dom.js';
import { App, registerApp, sys } from '../core/system.js';
import { db } from '../core/db.js';
import { asset, listAssets } from '../core/assets.js';
import { prefs } from '../core/prefs.js';
import { toolbar, toast, PageStack, dialog, emptyState } from '../core/ui.js';

const urls = new Map();
const urlOf = m => { if (m.src) return m.src; if (!urls.has(m.id)) urls.set(m.id, URL.createObjectURL(m.blob)); return urls.get(m.id); };

class Gallery extends App {
  onCreate(root, intent) {
    this.stack = new PageStack(root);
    this.albumsPage = h('div', null, toolbar({ title: 'Gallery', menu: [{ label: 'Import pictures…', onClick: () => this.importFiles() }] }), this.albumsGrid = h('div.page-content.gal-albums'));
    this.albumsPage.onShow = () => this.renderAlbums();
    this.stack.push(this.albumsPage, false);
    this.renderAlbums().then(() => { if (intent.album) this.openAlbum(intent.album); });
  }
  onResume() { if (this.stack.depth === 1) this.renderAlbums(); }
  onNewIntent(intent) { if (intent.album) { while (this.stack.pop()); this.openAlbum(intent.album); } }
  onBack() { return this.stack.pop(); }
  async items() {
    const media = (await db.all('media')).sort((a, b) => b.date - a.date);
    const wall = listAssets('wallpaper/').map((k, i) => ({ id: 'wp' + i, type: 'image', src: asset(k), album: 'Wallpapers', date: 0, key: k, readonly: true }));
    return media.concat(wall);
  }
  async renderAlbums() {
    const all = await this.items();
    const albums = {};
    all.forEach(m => (albums[m.album] = albums[m.album] || []).push(m));
    this.albumsGrid.innerHTML = '';
    if (!Object.keys(albums).length) this.albumsGrid.append(emptyState('photo', 'No pictures'));
    for (const [name, list] of Object.entries(albums)) {
      const cover = list.find(m => m.type === 'image');
      this.albumsGrid.append(h('div.gal-album.rip', { onclick: () => this.openAlbum(name) },
        cover ? h('img', { src: urlOf(cover), loading: 'lazy' }) : h('div.gal-video', icon('video')),
        h('div.gal-album-label', h('div', name), h('small', String(list.length)))));
    }
  }
  async openAlbum(name) {
    const list = (await this.items()).filter(m => m.album === name);
    const grid = h('div.page-content.gal-grid', null, list.map((m, i) => h('div.gal-cell.rip', { onclick: () => this.view(list, i) },
      m.type === 'image' ? h('img', { src: urlOf(m), loading: 'lazy' }) : h('div.gal-video', icon('play')))));
    this.stack.push(h('div', null, toolbar({ title: name, back: () => this.stack.pop() }), grid));
  }
  view(list, index) {
    let i = index;
    const stage = h('div.gal-stage');
    const bar = toolbar({ title: '', back: () => this.stack.pop(), cls: 'overlay-bar', actions: [
      { icon: 'share', label: 'Share', onClick: () => this.share(list[i]) },
      { icon: 'delete', label: 'Delete', onClick: () => this.remove(list[i], () => { list.splice(i, 1); if (!list.length) this.stack.pop(); else { i = Math.min(i, list.length - 1); show(); } }) }],
      menu: () => [{ label: 'Set picture as wallpaper', onClick: () => this.setWallpaper(list[i]) }, { label: 'Details', onClick: () => dialog({ title: 'Details', message: `Album: ${list[i].album}\nType: ${list[i].type}\n${list[i].date ? 'Taken: ' + new Date(list[i].date).toLocaleString() : 'Source: AOSP'}${list[i].w ? `\nSize: ${list[i].w}×${list[i].h}` : ''}`, buttons: [{ label: 'Close' }] }) }] });
    const page = h('div.gal-viewer', null, stage, bar);
    const show = () => {
      stage.innerHTML = '';
      const m = list[i];
      stage.append(m.type === 'image' ? h('img', { src: urlOf(m), draggable: false }) : h('video', { src: urlOf(m), controls: true, autoplay: true, playsinline: true }));
      bar.setTitle(`${i + 1} of ${list.length}`);
    };
    drag(stage, { axis: 'x', move: dx => { stage.firstChild.style.transform = `translateX(${dx}px)`; },
      end: (dx, dy, vx) => { if ((dx < -80 || vx < -0.5) && i < list.length - 1) i++; else if ((dx > 80 || vx > 0.5) && i > 0) i--; show(); } });
    stage.addEventListener('click', () => page.classList.toggle('immersive'));
    show();
    this.stack.push(page);
  }
  async share(m) {
    try {
      const blob = m.blob || await (await fetch(m.src)).blob();
      const file = new File([blob], m.type === 'image' ? 'IMG.jpg' : 'VID.webm', { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file] });
      else { const a = h('a', { href: URL.createObjectURL(blob), download: file.name }); a.click(); toast('Saved to Downloads'); }
    } catch {}
  }
  remove(m, done) {
    if (m.readonly) return toast('This picture is part of the system image');
    dialog({ message: 'Delete this item?', buttons: [{ label: 'Cancel' }, { label: 'OK', onClick: async () => { await db.del('media', m.id); toast('Deleted'); done(); } }] });
  }
  async setWallpaper(m) {
    if (m.key) { prefs.set('wallpaper', m.key); toast('Wallpaper set'); return; }
    const img = new Image(); img.src = urlOf(m); await img.decode();
    const k = Math.min(1, 1440 / Math.max(img.width, img.height));
    const c = h('canvas', { width: img.width * k, height: img.height * k }); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    try { localStorage.setItem('android5web.customwp', c.toDataURL('image/jpeg', 0.85)); prefs.set('wallpaper', '#000'); prefs.set('wallpaper', 'custom'); toast('Wallpaper set'); }
    catch { toast('Picture too large'); }
  }
  importFiles() {
    const inp = h('input', { type: 'file', accept: 'image/*,video/*', multiple: true });
    inp.onchange = async () => { for (const f of inp.files) await db.put('media', { type: f.type.startsWith('video') ? 'video' : 'image', blob: f, date: Date.now(), album: 'Imported' }); this.renderAlbums(); toast(`${inp.files.length} item(s) imported`); };
    inp.click();
  }
}
registerApp({ id: 'gallery', label: 'Gallery', icon: 'gallery', color: '#212121', colorDark: '#000000', accent: '#ff5722', pkg: 'com.android.gallery3d', stores: ['media'] }, Gallery);
