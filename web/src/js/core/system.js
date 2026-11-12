// ActivityManagerService + WindowManagerService, reduced to what a browser needs.
import { h, sleep } from './dom.js';
import { prefs } from './prefs.js';
import { asset } from './assets.js';

const registry = new Map();
export function registerApp(manifest, factory) { registry.set(manifest.id, { manifest, factory }); }
export function unregisterApp(id) { registry.delete(id); }
export const installedApps = () => [...registry.values()].map(r => r.manifest).filter(m => !m.hidden);
export const appManifest = id => registry.get(id)?.manifest;
// Launcher icon: bundled system apps use AOSP icons from the build, WAPKs carry their own
export const appIconUrl = m => (m && (m.iconUrl || asset(`icon/${m.icon}.png`))) || '';

class Emitter {
  constructor() { this._l = {}; }
  on(e, f) { (this._l[e] = this._l[e] || []).push(f); return () => this.off(e, f); }
  off(e, f) { const l = this._l[e]; if (l) { const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); } }
  emit(e, ...a) { (this._l[e] || []).slice().forEach(f => f(...a)); }
}

// Base class for every app ("Activity")
export class App {
  constructor(sys, task) { this.sys = sys; this.task = task; }
  get manifest() { return this.task.manifest; }
  onCreate(root, intent) {}
  onNewIntent(intent) {}
  onResume() {}
  onPause() {}
  onDestroy() {}
  onBack() { return false; }
  finish() { this.sys.finish(this.task); }
  setStatusBarColor(c) { this.task.statusColor = c; this.sys.emit('chrome'); }
  setFullscreen(v) { this.task.fullscreen = v; this.task.el.classList.toggle('fullscreen', v); this.sys.emit('chrome'); }
}

let nextTaskId = 1;
export class System extends Emitter {
  constructor() {
    super();
    this.tasks = [];       // recents order: most recent last
    this.current = null;   // foreground task or null (home)
    this.backStack = [];   // system-level overlays that consume BACK (shade, dialogs, ...)
    this.locked = true;
    this.screenOn = true;
    this.animScale = () => prefs.get('anim_scale');
  }
  attach(screen, windows, launcher) { this.screen = screen; this.windows = windows; this.launcher = launcher; }

  pushBack(fn) { this.backStack.push(fn); return () => { const i = this.backStack.indexOf(fn); if (i >= 0) this.backStack.splice(i, 1); }; }

  findTask(id) { return this.tasks.find(t => t.manifest.id === id); }

  async launch(id, intent = {}, origin = null) {
    const reg = registry.get(id);
    if (!reg) return null;
    this.emit('launch', id);
    let task = this.findTask(id);
    if (task && intent.clearTask) { this.destroy(task); task = null; }
    if (task) {
      if (this.current === task) { task.app.onNewIntent(intent); return task; }
      await this._switchTo(task, origin);
      task.app.onNewIntent(intent);
      return task;
    }
    task = { id: nextTaskId++, manifest: reg.manifest, statusColor: reg.manifest.colorDark, fullscreen: !!reg.manifest.fullscreen, from: intent.from || (this.current ? this.current.manifest.id : null) };
    const content = h('div.window-content');
    task.el = h('div.window', { 'data-app': id, class: task.fullscreen ? 'fullscreen' : '' }, content);
    if (reg.manifest.accent) task.el.style.setProperty('--accent', reg.manifest.accent);
    if (reg.manifest.color) task.el.style.setProperty('--primary', reg.manifest.color);
    if (reg.manifest.colorDark) task.el.style.setProperty('--primary-dark', reg.manifest.colorDark);
    task.app = new reg.factory(this, task);
    this.tasks.push(task);
    this.windows.append(task.el);
    try { task.app.onCreate(content, intent); } catch (e) { console.error(e); }
    await this._switchTo(task, origin, true);
    return task;
  }

  async _switchTo(task, origin, fresh = false) {
    const prev = this.current;
    if (prev && prev !== task) { prev.app.onPause(); }
    this.tasks.splice(this.tasks.indexOf(task), 1); this.tasks.push(task);
    this.current = task;
    task.lastUsed = Date.now();
    this.windows.append(task.el); // top of z-order
    task.el.hidden = false;
    this.emit('chrome');
    await this.animateIn(task.el, origin, fresh && !prev);
    if (prev && prev !== task) prev.el.hidden = true;
    this.launcher.classList.add('covered');
    task.app.onResume();
    this.emit('task', task);
  }

  animateIn(el, origin, fromHome) {
    const dur = 300 * this.animScale();
    if (!dur) return Promise.resolve();
    let kf;
    if (origin) {
      const s = this.screen.getBoundingClientRect(), k = s.width / this.screen.offsetWidth;
      const cx = ((origin.left + origin.width / 2) - s.left) / k, cy = ((origin.top + origin.height / 2) - s.top) / k;
      el.style.transformOrigin = `${cx}px ${cy - el.offsetTop}px`;
      kf = [{ transform: 'scale(0.1)', opacity: 0, borderRadius: '40px' }, { transform: 'scale(1)', opacity: 1, borderRadius: '0' }];
    } else {
      el.style.transformOrigin = '50% 50%';
      kf = [{ transform: 'translateY(8%)', opacity: 0 }, { transform: 'none', opacity: 1 }];
    }
    return el.animate(kf, { duration: dur, easing: 'cubic-bezier(0.0,0.0,0.2,1)' }).finished.catch(() => {});
  }
  animateOut(el) {
    const dur = 250 * this.animScale();
    if (!dur) return Promise.resolve();
    el.style.transformOrigin = '50% 50%';
    return el.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(0.9) translateY(4%)', opacity: 0 }],
      { duration: dur, easing: 'cubic-bezier(0.4,0.0,1,1)' }).finished.catch(() => {});
  }

  async home() {
    this.emit('home');
    const t = this.current;
    if (!t) { this.emit('home-pressed-on-home'); return; }
    t.app.onPause();
    this.current = null;
    this.launcher.classList.remove('covered');
    this.emit('chrome');
    await this.animateOut(t.el);
    if (this.current !== t) t.el.hidden = true;
    this.emit('task', null);
  }

  back() {
    if (this.backStack.length) { this.backStack[this.backStack.length - 1](); return; }
    if (!this.current) { this.emit('back-on-home'); return; }
    let handled = false;
    try { handled = this.current.app.onBack(); } catch (e) { console.error(e); }
    if (!handled) this.finish(this.current);
  }

  async finish(task) {
    if (!task) return;
    const wasCurrent = this.current === task;
    if (wasCurrent) {
      task.app.onPause();
      const from = task.from && this.findTask(task.from);
      this.current = null;
      if (from && from !== task) {
        this.current = from; from.el.hidden = false; from.lastUsed = Date.now();
        this.windows.insertBefore(from.el, task.el);
        this.tasks.splice(this.tasks.indexOf(from), 1); this.tasks.push(from);
      } else this.launcher.classList.remove('covered');
      this.emit('chrome');
      await this.animateOut(task.el);
      this.destroy(task, true);
      if (this.current) this.current.app.onResume();
      this.emit('task', this.current);
    } else this.destroy(task);
  }

  destroy(task, quiet) {
    const i = this.tasks.indexOf(task);
    if (i < 0) return;
    this.tasks.splice(i, 1);
    try { task.app.onDestroy(); } catch (e) { console.error(e); }
    task.el.remove();
    if (this.current === task) { this.current = null; this.launcher.classList.remove('covered'); }
    if (!quiet) { this.emit('chrome'); this.emit('task', this.current); }
  }

  // Recents: switching without animation from the overview
  async resumeFromRecents(task) {
    if (this.current && this.current !== task) { this.current.app.onPause(); this.current.el.hidden = true; }
    this.tasks.splice(this.tasks.indexOf(task), 1); this.tasks.push(task);
    this.current = task; task.el.hidden = false; task.lastUsed = Date.now();
    this.windows.append(task.el);
    this.launcher.classList.add('covered');
    this.emit('chrome');
    task.app.onResume();
    this.emit('task', task);
  }
}

export const sys = new System();
window.__android = sys; // handy for debugging from DevTools
