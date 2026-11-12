// Web implementation of a file explorer for the WAPK converted from
// com.cxinventor.file.explorer (the APK's Dalvik code cannot run in the browser).
// Original code written against the WAPK runtime API (web/docs/WAPK.md).
export default function createApp(android) {
  const { App, h, icon, ui, onLongPress } = android;
  const fsApi = android.storage;
  const { join, dirname, basename, ext, kindOf, mimeOf } = fsApi;

  const KIND_ICON = { folder: 'folder', image: 'photo', audio: 'music', video: 'video', text: 'edit', archive: 'download', package: 'settings', file: 'info' };
  const KIND_COLOR = { folder: '#ffa000', image: '#43a047', audio: '#8e24aa', video: '#e53935', text: '#1e88e5', archive: '#6d4c41', package: '#00897b', file: '#757575' };
  const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB';
  const fmtDate = t => t ? new Date(t).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const LIBRARY = [
    ['image', 'Images', 'photo'], ['audio', 'Audio', 'music'], ['video', 'Videos', 'video'],
    ['text', 'Documents', 'edit'], ['package', 'Apps (.wapk)', 'settings'], ['archive', 'Archives', 'download'],
  ];

  return class FileExplorer extends App {
    onCreate(root) {
      this.root = root;
      this.stack = new ui.PageStack(h('div.fx-stack'));
      this.clip = null; // { op: 'copy'|'cut', vol, paths }
      this.sort = android.prefs.get('sort', 'name');
      this.grid = android.prefs.get('grid', false);
      this.pasteBar = h('div.fx-paste');
      root.append(h('div.fx', null, this.stack.root, this.pasteBar));
      this.showHome();
    }
    onBack() {
      const top = this.stack.top;
      if (top && top.selection && top.selection.size) { top.clearSelection(); return true; }
      return this.stack.pop();
    }
    onResume() { const top = this.stack.top; top && top.refresh && top.refresh(); }

    // ------------------------------------------------------------ home
    async showHome() {
      const cards = h('div.fx-cards');
      const lib = h('div.fx-lib');
      const recent = h('div.fx-recent');
      const page = h('div.fx-page', null,
        ui.toolbar({ title: android.manifest.label, menu: [{ label: 'About', onClick: () => this.about() }] }),
        h('div.page-content', null, h('div.fx-section', 'Storage'), cards, h('div.fx-section', 'Library'), lib, h('div.fx-section', 'Recent files'), recent));
      page.refresh = async () => {
        cards.innerHTML = ''; lib.innerHTML = ''; recent.innerHTML = '';
        const internal = await fsApi.internal();
        const u = await fsApi.usage();
        cards.append(this.storageCard('Internal storage', `${fmtSize(u.used)} used of ${fmtSize(u.total)}`, u.total ? u.used / u.total : 0, 'folder', () => this.openDir(internal, '/'), internal.backend));
        cards.append(this.storageCard('System', 'Read-only · AOSP files in this build', -1, 'settings', () => this.openDir(fsApi.system(), '/'), '/system'));
        if (fsApi.canPickFolders()) cards.append(this.storageCard('Device folder', 'Open a folder on this computer', 0, 'globe', async () => {
          try { const v = await fsApi.pickFolder(); this.openDir(v, '/'); } catch { /* cancelled */ }
        }, 'File System Access API'));
        for (const [kind, label, ic] of LIBRARY) lib.append(h('button.fx-libitem.rip', { onclick: () => this.openLibrary(kind, label) }, h('span.fx-libicon', { style: { background: KIND_COLOR[kind] } }, icon(ic)), h('span', label)));
        lib.append(h('button.fx-libitem.rip', { onclick: () => this.openDir(internal, '/Download') }, h('span.fx-libicon', { style: { background: '#3949ab' } }, icon('download')), h('span', 'Downloads')));
        const files = (await fsApi.walk(internal, '/')).sort((a, b) => b.mtime - a.mtime).slice(0, 6);
        if (!files.length) recent.append(h('div.fx-empty-small', 'No recent files'));
        for (const f of files) recent.append(this.row(internal, f, [f], { subtitle: dirname(f.path) }));
      };
      this.stack.push(page, false);
      page.refresh();
    }
    storageCard(title, summary, frac, ic, onClick, note) {
      return h('div.fx-card.rip', { onclick: onClick },
        h('span.fx-cardicon', icon(ic)),
        h('div.fx-cardtext', h('div.fx-cardtitle', title), h('div.fx-cardsum', summary), frac >= 0 ? h('div.fx-bar', h('div', { style: { width: Math.min(100, frac * 100) + '%' } })) : null, note ? h('div.fx-cardnote', note) : null));
    }
    about() {
      const src = android.manifest;
      ui.dialog({ title: src.label, message: `${src.package} ${src.versionName} (${src.versionCode})\n\nThis is a web implementation installed from a .wapk package. The original Android app's Dalvik code cannot run in this browser port, so its file management features are reimplemented on the browser's storage APIs.`, buttons: [{ label: 'OK' }] });
    }

    // ------------------------------------------------------------ library (search by type)
    async openLibrary(kind, label) {
      const internal = await fsApi.internal();
      const list = h('div.fx-list');
      const page = h('div.fx-page', null, ui.toolbar({ title: label, back: () => this.stack.pop() }), h('div.page-content', list));
      page.refresh = async () => {
        list.innerHTML = '';
        const files = (await fsApi.walk(internal, '/')).filter(f => kindOf(f.name) === kind).sort((a, b) => b.mtime - a.mtime);
        if (!files.length) list.append(ui.emptyState('folder', `No ${label.toLowerCase()} in internal storage`));
        for (const f of files) list.append(this.row(internal, f, files, { subtitle: dirname(f.path) }));
      };
      this.stack.push(page);
      page.refresh();
    }

    // ------------------------------------------------------------ directory browser
    openDir(vol, path) {
      const list = h('div.fx-list' + (this.grid ? '.grid' : ''));
      const crumbs = h('div.fx-crumbs');
      const fab = ui.fab('add', () => this.createMenu(vol, path, page));
      fab.hidden = vol.readOnly;
      const tb = ui.toolbar({ title: path === '/' ? vol.label : basename(path), sub: vol.label, back: () => this.stack.pop(), menu: () => [
        { label: 'Sort by name', onClick: () => this.setSort('name', page) }, { label: 'Sort by date', onClick: () => this.setSort('date', page) },
        { label: 'Sort by size', onClick: () => this.setSort('size', page) }, { label: this.grid ? 'List view' : 'Grid view', onClick: () => { this.grid = !this.grid; android.prefs.set('grid', this.grid); list.classList.toggle('grid', this.grid); page.refresh(); } },
        { label: 'Select all', onClick: () => page.selectAll() }, !vol.readOnly ? { label: 'Import files from device…', onClick: () => this.importFiles(vol, path, page) } : null] });
      const selBar = h('div.fx-selbar');
      const page = h('div.fx-page', null, tb, selBar, crumbs, h('div.page-content', list), fab);
      page.vol = vol; page.path = path;
      page.selection = new Set();
      page.entries = [];
      page.clearSelection = () => { page.selection.clear(); render(); };
      page.selectAll = () => { page.entries.forEach(e => page.selection.add(e.path)); render(); };
      const render = () => {
        list.innerHTML = '';
        if (!page.entries.length) list.append(ui.emptyState('folder', 'This folder is empty'));
        for (const e of page.entries) list.append(this.row(vol, e, page.entries, { page, selected: page.selection.has(e.path) }));
        selBar.innerHTML = '';
        selBar.hidden = !page.selection.size;
        if (page.selection.size) {
          const paths = [...page.selection];
          const act = (ic, label, fn, show = true) => show ? h('button.tb-btn.rip.rip-u', { title: label, onclick: fn }, icon(ic)) : null;
          selBar.append(
            act('close', 'Done', () => page.clearSelection()), h('div.fx-selcount', `${paths.length} selected`),
            act('copy', 'Copy', () => this.setClip('copy', vol, paths, page)),
            act('cut', 'Move', () => this.setClip('cut', vol, paths, page), !vol.readOnly),
            act('delete', 'Delete', () => this.remove(vol, paths, page), !vol.readOnly),
            act('more', 'More', e => ui.popupMenu(e.currentTarget, [
              paths.length === 1 && !vol.readOnly ? { label: 'Rename', onClick: () => this.rename(vol, paths[0], page) } : null,
              !vol.readOnly ? { label: 'Compress to .zip', onClick: () => this.compress(vol, paths, page) } : null,
              { label: 'Save to this computer', onClick: () => this.download(vol, paths) },
              { label: 'Details', onClick: () => this.details(vol, paths) },
            ])));
        }
        crumbs.innerHTML = '';
        const segs = path.split('/').filter(Boolean);
        crumbs.append(h('button.fx-crumb.rip', { onclick: () => this.jump(vol, '/') }, vol.label));
        segs.forEach((s, i) => crumbs.append(icon('chevronRight'), h('button.fx-crumb.rip', { onclick: () => this.jump(vol, '/' + segs.slice(0, i + 1).join('/')) }, s)));
        requestAnimationFrame(() => { crumbs.scrollLeft = crumbs.scrollWidth; });
      };
      page.render = render;
      page.refresh = async () => {
        try { page.entries = this.sorted(await vol.list(path)); }
        catch (e) { page.entries = []; ui.toast('Can’t open folder: ' + e.message); }
        for (const p of [...page.selection]) if (!page.entries.some(e => e.path === p)) page.selection.delete(p);
        render(); this.renderPaste();
      };
      this.stack.push(page);
      page.refresh();
    }
    jump(vol, path) {
      // pop back to an existing page for that path, else open it
      const idx = this.stack.stack.findIndex(p => p.vol === vol && p.path === path);
      if (idx >= 0) { while (this.stack.depth - 1 > idx) this.stack.pop(); } else this.openDir(vol, path);
    }
    sorted(entries) {
      const by = { name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }), date: (a, b) => b.mtime - a.mtime, size: (a, b) => b.size - a.size }[this.sort];
      return entries.slice().sort((a, b) => (b.isDir - a.isDir) || by(a, b));
    }
    setSort(s, page) { this.sort = s; android.prefs.set('sort', s); page.refresh(); }

    row(vol, e, siblings, { page, selected, subtitle } = {}) {
      const kind = e.isDir ? 'folder' : kindOf(e.name);
      const thumb = h('span.fx-icon', { style: { background: KIND_COLOR[kind] } }, icon(KIND_ICON[kind]));
      if (kind === 'image' && e.size < 8e6) vol.readFile(e.path).then(b => { const u = URL.createObjectURL(b); thumb.style.background = `center/cover url(${u})`; thumb.innerHTML = ''; }).catch(() => {});
      const sub = subtitle || (e.isDir ? 'Folder' : [fmtSize(e.size), fmtDate(e.mtime)].filter(Boolean).join(' · '));
      const el = h('div.fx-row.rip' + (selected ? '.selected' : ''), null, thumb, h('div.fx-rowtext', h('div.fx-name', e.name), h('div.fx-sub', sub)));
      el.addEventListener('click', () => {
        if (el.dataset.lp) { delete el.dataset.lp; return; }
        android.sound.click();
        if (page && page.selection.size) { page.selection.has(e.path) ? page.selection.delete(e.path) : page.selection.add(e.path); page.render(); return; }
        if (e.isDir) this.openDir(vol, e.path); else this.openFile(vol, e, siblings);
      });
      if (page) onLongPress(el, () => { el.dataset.lp = '1'; android.sound.vibrate(25); page.selection.add(e.path); page.render(); });
      return el;
    }

    // ------------------------------------------------------------ create / import
    createMenu(vol, path, page) {
      ui.dialog({ title: 'New', items: [
        { label: 'Folder', onClick: () => ui.prompt({ title: 'New folder', placeholder: 'Folder name', onOk: async n => { if (!n) return; await vol.mkdir(join(path, n)).catch(err => ui.toast(err.message)); page.refresh(); } }) },
        { label: 'Text file', onClick: () => ui.prompt({ title: 'New file', value: 'New file.txt', onOk: async n => { if (!n) return; await vol.writeFile(join(path, n), '').catch(err => ui.toast(err.message)); page.refresh(); } }) },
        { label: 'Import files from device', onClick: () => this.importFiles(vol, path, page) },
      ] });
    }
    importFiles(vol, path, page) {
      const inp = h('input', { type: 'file', multiple: true });
      inp.onchange = async () => {
        for (const f of inp.files) await vol.writeFile(join(path, f.name), f).catch(err => ui.toast(err.message));
        ui.toast(`${inp.files.length} file(s) imported`); page.refresh();
      };
      inp.click();
    }

    // ------------------------------------------------------------ clipboard
    setClip(op, vol, paths, page) {
      this.clip = { op, vol, paths };
      page.clearSelection();
      ui.toast(`${paths.length} item(s) ${op === 'copy' ? 'copied' : 'ready to move'}`);
      this.renderPaste();
    }
    renderPaste() {
      const bar = this.pasteBar, top = this.stack.top;
      bar.innerHTML = '';
      const ok = this.clip && top && top.vol && !top.vol.readOnly;
      bar.hidden = !ok;
      if (!ok) return;
      bar.append(h('div', `${this.clip.paths.length} item(s) to ${this.clip.op === 'copy' ? 'copy' : 'move'}`),
        ui.button('Cancel', () => { this.clip = null; this.renderPaste(); }),
        ui.button('Paste', () => this.paste(top)));
    }
    async paste(page) {
      const { op, vol, paths } = this.clip;
      let n = 0;
      for (const p of paths) {
        let dst = join(page.path, basename(p));
        if (vol === page.vol && (dst === p || dst.startsWith(p + '/'))) { if (op === 'cut') continue; dst = join(page.path, 'Copy of ' + basename(p)); }
        while (await page.vol.stat(dst).catch(() => null)) dst = dst.replace(/(\.[^./]+)?$/, ' (1)$1');
        try {
          await fsApi.copy(vol, p, page.vol, dst);
          if (op === 'cut') await vol.remove(p);
          n++;
        } catch (e) { ui.toast(e.message); }
      }
      ui.toast(`${n} item(s) ${op === 'copy' ? 'copied' : 'moved'}`);
      this.clip = null;
      page.refresh();
    }

    // ------------------------------------------------------------ operations
    remove(vol, paths, page) {
      ui.dialog({ title: 'Delete', message: `Delete ${paths.length === 1 ? '"' + basename(paths[0]) + '"' : paths.length + ' items'}?`, buttons: [{ label: 'Cancel' }, { label: 'Delete', onClick: async () => {
        for (const p of paths) await vol.remove(p).catch(e => ui.toast(e.message));
        page.selection.clear(); page.refresh(); ui.toast('Deleted');
      } }] });
    }
    rename(vol, p, page) {
      ui.prompt({ title: 'Rename', value: basename(p), onOk: async n => {
        if (!n || n === basename(p)) return;
        const dst = join(dirname(p), n);
        try { await fsApi.copy(vol, p, vol, dst); await vol.remove(p); } catch (e) { ui.toast(e.message); }
        page.selection.clear(); page.refresh();
      } });
    }
    async details(vol, paths) {
      let size = 0, files = 0, dirs = 0;
      for (const p of paths) {
        const st = await vol.stat(p);
        if (st && st.isDir) { dirs++; for (const f of await fsApi.walk(vol, p)) { files++; size += f.size; } } else if (st) { files++; size += st.size || (await vol.readFile(p)).size; }
      }
      const one = paths.length === 1 ? await vol.stat(paths[0]) : null;
      ui.dialog({ title: 'Details', message: [one ? `Name: ${one.name}` : `${paths.length} items`, `Location: ${vol.label}${paths.length === 1 ? dirname(paths[0]) : ''}`,
        `Contains: ${files} file(s)${dirs ? `, ${dirs} folder(s)` : ''}`, `Size: ${fmtSize(size)}`, one && !one.isDir ? `Type: ${mimeOf(one.name)}` : null, one && one.mtime ? `Modified: ${fmtDate(one.mtime)}` : null].filter(Boolean).join('\n'), buttons: [{ label: 'OK' }] });
    }
    async download(vol, paths) {
      for (const p of paths) {
        const st = await vol.stat(p);
        if (st && st.isDir) { ui.toast('Compress folders to .zip first'); continue; }
        const b = await vol.readFile(p);
        const a = h('a', { href: URL.createObjectURL(b), download: basename(p) }); a.click();
      }
    }
    async compress(vol, paths, page) {
      const { writeZip } = android.zip;
      const entries = [];
      for (const p of paths) {
        const st = await vol.stat(p);
        const base = dirname(p);
        const add = async f => entries.push({ name: f.path.slice(base === '/' ? 1 : base.length + 1), data: new Uint8Array(await (await vol.readFile(f.path)).arrayBuffer()), mtime: f.mtime });
        if (st.isDir) for (const f of await fsApi.walk(vol, p)) await add(f); else await add({ path: p, mtime: st.mtime });
      }
      const name = (paths.length === 1 ? basename(paths[0]).replace(/\.[^.]+$/, '') : 'Archive') + '.zip';
      await vol.writeFile(join(page.path, name), new Blob([await writeZip(entries)], { type: 'application/zip' }));
      page.selection.clear(); page.refresh(); ui.toast(`Created ${name}`);
    }

    // ------------------------------------------------------------ viewers
    async openFile(vol, e, siblings) {
      const kind = kindOf(e.name);
      if (kind === 'package') {
        const bytes = new Uint8Array(await (await vol.readFile(e.path)).arrayBuffer());
        try { android.installPackage(bytes, e.name); } catch (err) { ui.toast(err.message); }
        return;
      }
      if (kind === 'image') return this.imageViewer(vol, siblings.filter(s => !s.isDir && kindOf(s.name) === 'image'), e);
      if (kind === 'audio' || kind === 'video') return this.mediaViewer(vol, e, kind);
      if (kind === 'text' || e.size < 64 * 1024 && /^(|conf|cfg|ini|prop|log|sh|c|h|java|kt|py|rc|mk)$/.test(ext(e.name))) return this.textViewer(vol, e);
      if (kind === 'archive') return this.zipViewer(vol, e);
      ui.dialog({ title: e.name, message: `No app can open this file (${mimeOf(e.name)}).`, buttons: [{ label: 'Save to this computer', onClick: () => this.download(vol, [e.path]) }, { label: 'Close' }] });
    }
    async imageViewer(vol, images, start) {
      let i = Math.max(0, images.findIndex(x => x.path === start.path));
      const img = h('img.fx-img', { draggable: false });
      const tb = ui.toolbar({ title: '', back: () => this.stack.pop(), cls: 'overlay-bar' });
      const show = async () => { tb.setTitle(images[i].name); img.src = URL.createObjectURL(await vol.readFile(images[i].path)); };
      const stage = h('div.fx-imgstage', null, img);
      android.drag(stage, { axis: 'x', move: dx => { img.style.transform = `translateX(${dx}px)`; }, end: dx => { img.style.transform = ''; if (dx < -60 && i < images.length - 1) i++; else if (dx > 60 && i > 0) i--; show(); } });
      this.stack.push(h('div.fx-page.fx-dark', null, stage, tb));
      show();
    }
    async mediaViewer(vol, e, kind) {
      const url = URL.createObjectURL(await vol.readFile(e.path));
      const el = kind === 'audio' ? h('audio.fx-audio', { src: url, controls: true, autoplay: true }) : h('video.fx-video', { src: url, controls: true, autoplay: true, playsinline: true });
      const page = h('div.fx-page.fx-dark', null, ui.toolbar({ title: e.name, back: () => this.stack.pop(), cls: 'transparent' }),
        h('div.fx-media', kind === 'audio' ? h('div.fx-audioart', icon('music')) : null, el));
      page.onHide = () => { el.pause(); };
      this.stack.push(page);
    }
    async textViewer(vol, e) {
      const ta = h('textarea.fx-text', { spellcheck: false, readOnly: vol.readOnly });
      ta.value = await (await vol.readFile(e.path)).text();
      let dirty = false;
      ta.addEventListener('input', () => { dirty = true; });
      const save = async () => { try { await vol.writeFile(e.path, new Blob([ta.value], { type: mimeOf(e.name) })); dirty = false; ui.toast('Saved'); } catch (err) { ui.toast(err.message); } };
      this.stack.push(h('div.fx-page', null, ui.toolbar({ title: e.name, sub: vol.readOnly ? 'Read-only' : null, back: () => {
        if (dirty) ui.dialog({ message: 'Discard unsaved changes?', buttons: [{ label: 'Cancel' }, { label: 'Discard', onClick: () => this.stack.pop() }] }); else this.stack.pop();
      }, actions: vol.readOnly ? [] : [{ icon: 'check', label: 'Save', onClick: save }] }), ta));
    }
    async zipViewer(vol, e) {
      const { readZip } = android.zip;
      const zip = readZip(new Uint8Array(await (await vol.readFile(e.path)).arrayBuffer()));
      const list = h('div.fx-list');
      for (const z of zip.entries.values()) list.append(h('div.fx-row', h('span.fx-icon', { style: { background: KIND_COLOR[z.dir ? 'folder' : kindOf(z.name)] } }, icon(z.dir ? 'folder' : KIND_ICON[kindOf(z.name)])),
        h('div.fx-rowtext', h('div.fx-name', z.name), h('div.fx-sub', z.dir ? 'Folder' : fmtSize(z.size)))));
      const extract = async () => {
        const dest = join(dirname(e.path), basename(e.path).replace(/\.zip$/i, ''));
        for (const z of zip.entries.values()) if (z.dir) await vol.mkdir(join(dest, z.name)); else await vol.writeFile(join(dest, z.name), new Blob([await zip.read(z)]));
        ui.toast(`Extracted to ${basename(dest)}`); this.stack.pop(); this.stack.top.refresh && this.stack.top.refresh();
      };
      this.stack.push(h('div.fx-page', null, ui.toolbar({ title: e.name, sub: `${zip.entries.size} entries`, back: () => this.stack.pop(), actions: vol.readOnly ? [] : [{ icon: 'download', label: 'Extract here', onClick: extract }] }), h('div.page-content', list)));
    }
  };
}
