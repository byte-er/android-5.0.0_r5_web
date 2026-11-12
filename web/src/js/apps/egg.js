// Lollipop easter eggs, ported from Java:
//  - frameworks/base/core/java/com/android/internal/app/PlatLogoActivity.java
//  - frameworks/base/packages/SystemUI/src/com/android/systemui/egg/LLand.java
import { h, vector } from '../core/dom.js';
import { App, registerApp, sys } from '../core/system.js';
import { prefs } from '../core/prefs.js';

// ============================================================ PlatLogoActivity
const FLAVORS = [0xFF9C27B0, 0xFFBA68C8, 0xFFFF9800, 0xFFFFB74D, 0xFFF06292, 0xFFF8BBD0, 0xFFAFB42B, 0xFFCDDC39, 0xFFFFEB3B, 0xFFFFF176, 0xFF795548, 0xFFA1887F];
const hex = c => '#' + (c & 0xFFFFFF).toString(16).padStart(6, '0');
const newColorIndex = () => 2 * Math.floor(Math.random() * FLAVORS.length / 2);
const EASE = 'cubic-bezier(0, 0, 0.5, 1)'; // PathInterpolator(0f, 0f, 0.5f, 1f)

class PlatLogo extends App {
  onCreate(root) {
    this.tapCount = 0;
    const W = root.offsetWidth || 360, H = root.offsetHeight || 640;
    const size = Math.min(Math.min(W, H), 600) - 100;
    const stick = h('div.pl-stick', { style: { height: '50%', opacity: 0 } });
    stick.style.setProperty('--size', size + 'px');
    const logo = vector('platlogo', 'pl-logo');
    logo.style.opacity = 0;
    const im = h('button.pl-pop', { style: { width: size + 'px', height: size + 'px', transform: 'scale(0)' } }, h('div.pl-highlight'), logo);
    const makeRipple = () => { const i = newColorIndex(); im.style.background = hex(FLAVORS[i]); im.style.setProperty('--ripple', hex(FLAVORS[i + 1])); };
    makeRipple();
    root.append(h('div.platlogo', null, stick, im));
    im.animate([{ transform: 'scale(0)' }, { transform: 'scale(0.3)' }], { duration: 500, delay: 800, easing: EASE, fill: 'forwards' });
    let lp = null;
    im.addEventListener('click', () => {
      if (this.tapCount === 0) {
        im.animate([{ transform: 'scale(0.3)', boxShadow: '0 10px 20px rgba(0,0,0,.3)' }, { transform: 'scale(1)', boxShadow: '0 20px 40px rgba(0,0,0,.35)' }], { duration: 700, delay: 500, easing: EASE, fill: 'forwards' });
        logo.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 1000, easing: EASE, fill: 'forwards' });
        stick.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 750, easing: EASE, fill: 'forwards' });
      } else makeRipple();
      im.animate([{ boxShadow: `inset 0 0 0 0 var(--ripple)` }, { boxShadow: `inset 0 0 0 ${size}px var(--ripple)`, offset: 0.6 }, { boxShadow: `inset 0 0 0 ${size}px transparent` }], { duration: 600, composite: 'add' });
      this.tapCount++;
    });
    im.addEventListener('pointerdown', () => { lp = setTimeout(() => {
      if (this.tapCount < 5) return;
      if (!prefs.get('egg_mode')) prefs.set('egg_mode', Date.now()); // "For posterity: the moment this user unlocked the easter egg"
      this.finish(); sys.launch('lland', { clearTask: true });
    }, 600); });
    im.addEventListener('pointerup', () => clearTimeout(lp));
    im.addEventListener('pointerleave', () => clearTimeout(lp));
  }
}
registerApp({ id: 'platlogo', label: 'Android', icon: 'home', fullscreen: true, hidden: true, colorDark: 'transparent' }, PlatLogo);

// ============================================================ LLand
const P = { // res/values/lland_config.xml (dp)
  TRANSLATION_PER_SEC: 100, OBSTACLE_SPACING: 380, BOOST_DV: 550, PLAYER_HIT_SIZE: 40, PLAYER_SIZE: 40, OBSTACLE_WIDTH: 90, OBSTACLE_STEM_WIDTH: 12,
  OBSTACLE_GAP: 170, OBSTACLE_MIN: 40, BUILDING_WIDTH_MIN: 20, BUILDING_WIDTH_MAX: 250, BUILDING_HEIGHT_MIN: 20, CLOUD_SIZE_MIN: 10, CLOUD_SIZE_MAX: 100,
  SUN_SIZE: 45, STAR_SIZE_MIN: 3, STAR_SIZE_MAX: 5, G: 30, MAX_V: 1000, SCENERY_Z: 6, OBSTACLE_Z: 18, PLAYER_Z: 18, PLAYER_Z_BOOST: 20, HUD_Z: 35,
};
P.OBSTACLE_PERIOD = Math.floor(P.OBSTACLE_SPACING / P.TRANSLATION_PER_SEC);
const POPS = ['pop_belt', 0, 'pop_droid', 0, 'pop_pizza', 1, 'pop_stripes', 0, 'pop_swirl', 1, 'pop_vortex', 1, 'pop_vortex2', 1];
const DAY = 0, NIGHT = 1, TWILIGHT = 2, SUNSET = 3;
const SKIES = [['#c0c0ff', '#a0a0ff'], ['#000010', '#000000'], ['#000040', '#000010'], ['#a08020', '#204080']];
const lerp = (x, a, b) => (b - a) * x + a, rlerp = (v, a, b) => (v - a) / (b - a), clamp = f => f < 0 ? 0 : f > 1 ? 1 : f;
const frand = (a, b) => a === undefined ? Math.random() : lerp(Math.random(), a, b);
const irand = (a, b) => Math.floor(lerp(Math.random(), a, b));
const hsv = (hh, s, v) => { const f = n => { const k = (n + hh / 60) % 6; return v - v * s * Math.max(Math.min(k, 4 - k, 1), 0); }; return `rgb(${f(5) * 255 | 0},${f(3) * 255 | 0},${f(1) * 255 | 0})`; };

// A View with translation/rotation/scale/elevation, plus ViewPropertyAnimator-style tweens
class GView {
  constructor(world, el, w, hgt, top = 0, left = 0) {
    Object.assign(this, { world, el, w, h: hgt, top, left, tx: 0, ty: 0, rot: 0, sx: 1, sy: 1, z: 0, anims: [] });
    el.classList.add('ll-view'); el.style.width = w + 'px'; el.style.height = hgt + 'px';
    world.layer.append(el); world.children.push(this);
  }
  animate(props, duration, delay = 0, ease = t => t) {
    const from = {}; for (const k in props) from[k] = this[k];
    this.anims = this.anims.filter(a => !Object.keys(props).some(k => k in a.props));
    this.anims.push({ props, from, start: this.world.now + delay, duration, ease });
  }
  cancelAnim() { this.anims = []; }
  tween(now) {
    this.anims = this.anims.filter(a => {
      if (now < a.start) return true;
      const p = Math.min(1, (now - a.start) / a.duration), e = a.ease(p);
      for (const k in a.props) this[k] = a.from[k] + (a.props[k] - a.from[k]) * e;
      return p < 1;
    });
  }
  apply() {
    this.el.style.transform = `translate(${this.left + this.tx}px, ${this.top + this.ty}px) rotate(${this.rot}deg) scale(${this.sx}, ${this.sy})`;
    if (this.z) this.el.style.filter = `drop-shadow(0 ${this.z / 3}px ${this.z / 3}px rgba(0,0,0,0.3))`;
  }
  hitRect() { // View.getHitRect (axis aligned bounds of the transformed view)
    const cx = this.left + this.tx + this.w / 2, cy = this.top + this.ty + this.h / 2;
    const hw = Math.abs(this.w * this.sx) / 2, hh = Math.abs(this.h * this.sy) / 2;
    return { left: Math.trunc(cx - hw), top: Math.trunc(cy - hh), right: Math.trunc(cx + hw), bottom: Math.trunc(cy + hh) };
  }
  remove() { this.el.remove(); const i = this.world.children.indexOf(this); if (i >= 0) this.world.children.splice(i, 1); }
}

class LLandApp extends App {
  onCreate(root) {
    this.root = root;
    this.layer = h('div.ll-world');
    this.score = h('div.ll-score', '0');
    this.el = h('div.lland', { tabindex: 0 }, this.layer, this.score);
    root.append(this.el);
    this.timeOfDay = irand(0, SKIES.length);
    const down = e => { e.preventDefault(); this.poke(); }, up = () => this.unpoke();
    this.el.addEventListener('pointerdown', down);
    this.el.addEventListener('pointerup', up);
    this.keyDown = e => { if (sys.current !== this.task) return; if ([' ', 'Enter', 'ArrowUp'].includes(e.key)) { e.preventDefault(); if (!e.repeat) this.poke(); } };
    this.keyUp = e => { if ([' ', 'Enter', 'ArrowUp'].includes(e.key)) this.unpoke(); };
    window.addEventListener('keydown', this.keyDown); window.addEventListener('keyup', this.keyUp);
    requestAnimationFrame(() => { this.reset(); this.start(false); });
  }
  onDestroy() { this.stop(); cancelAnimationFrame(this.raf); window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp); }
  onPause() { cancelAnimationFrame(this.raf); this.raf = null; }
  onResume() { if (this.animating && !this.raf) { this.last = null; this.raf = requestAnimationFrame(t => this.frame(t)); } }

  setScore(s) { this.mScore = s; this.score.textContent = String(s); }
  reset() {
    const [c0, c1] = SKIES[this.timeOfDay];
    this.el.style.background = `linear-gradient(to top, ${c0}, ${c1})`;
    this.flipped = frand() > 0.5;
    this.layer.style.transform = this.flipped ? 'scaleX(-1)' : '';
    this.setScore(0);
    this.layer.innerHTML = ''; this.children = []; this.obstacles = [];
    this.W = this.el.offsetWidth; this.H = this.el.offsetHeight;
    this.now = 0;
    const W = this.W, H = this.H;
    const showingSun = (this.timeOfDay === DAY || this.timeOfDay === SUNSET) && frand() > 0.25;
    if (showingSun) {
      const w = P.SUN_SIZE, sun = new GView(this, vector('sun', 'll-fill'), w, w);
      sun.kind = 'scenery'; sun.v = 0; sun.sw = w;
      sun.tx = frand(w, W - w);
      if (this.timeOfDay === DAY) sun.ty = frand(w, H * 0.66);
      else { sun.ty = frand(H * 0.66, H - w); sun.el.classList.add('tint-sunset'); }
    } else {
      const dark = this.timeOfDay === NIGHT || this.timeOfDay === TWILIGHT, ff = frand();
      if ((dark && ff < 0.75) || ff < 0.5) {
        const w = P.SUN_SIZE, moon = new GView(this, vector('moon', 'll-fill'), w, w);
        moon.kind = 'scenery'; moon.v = 0; moon.sw = w;
        moon.el.style.opacity = dark ? 1 : 0.5;
        moon.sx = frand() > 0.5 ? -1 : 1; moon.rot = moon.sx * frand(5, 30);
        moon.tx = frand(w, W - w); moon.ty = frand(w, H - w);
      }
    }
    const mh = Math.floor(H / 6), cloudless = frand() < 0.25, N = 20;
    for (let i = 0; i < N; i++) {
      const r1 = frand();
      let s;
      if (r1 < 0.3 && this.timeOfDay !== DAY) { const w = irand(P.STAR_SIZE_MIN, P.STAR_SIZE_MAX); s = new GView(this, vector('star', 'll-fill'), w, w); s.v = 0; }
      else if (r1 < 0.6 && !cloudless) {
        const w = irand(P.CLOUD_SIZE_MIN, P.CLOUD_SIZE_MAX);
        s = new GView(this, vector(frand() < 0.01 ? 'cloud_off' : 'cloud', 'll-fill'), w, w); s.el.style.opacity = 0x40 / 255; s.v = frand(0.15, 0.5);
      } else {
        const z = i / N, w = irand(P.BUILDING_WIDTH_MIN, P.BUILDING_WIDTH_MAX), hh = irand(P.BUILDING_HEIGHT_MIN, mh);
        s = new GView(this, h('div'), w, hh, H - hh); s.v = 0.85 * z; s.el.style.background = hsv(175, 0.25, z);
        s.el.style.boxShadow = `0 0 ${P.SCENERY_Z * (1 + z) / 2}px rgba(0,0,0,0.3)`; s.building = true;
      }
      s.kind = 'scenery'; s.sw = s.w;
      if (!s.building) { const r = frand(); s.top = s.w <= P.STAR_SIZE_MAX ? Math.trunc(r * r * H) : Math.trunc(1 - r * r * H / 2) + H / 2; }
      s.tx = frand(-s.w, W + s.w);
    }
    // Player
    this.droid = new GView(this, vector('android', 'll-player'), P.PLAYER_SIZE, P.PLAYER_SIZE);
    this.droid.kind = 'player'; this.droid.dv = 0; this.droid.boosting = false; this.droid.z = P.PLAYER_Z;
    this.droid.tx = W / 2; this.droid.ty = H / 2;
    this.droid.corners = [];
    this.score.style.transform = 'translateY(-500px)';
  }
  start(startPlaying) {
    if (startPlaying) {
      this.playing = true;
      this.t = 0; this.tStart = null;
      this.lastPipeTime = -P.OBSTACLE_PERIOD;
      this.score.animate([{ transform: getComputedStyle(this.score).transform }, { transform: 'none' }], { duration: 1500, easing: 'cubic-bezier(0,0,.2,1)', fill: 'forwards' });
      this.score.className = 'll-score';
      this.droid.el.hidden = false; this.droid.tx = this.W / 2; this.droid.ty = this.H / 2;
    } else this.droid.el.hidden = true;
    if (!this.animating) { this.animating = true; this.last = null; this.tStart = null; this.raf = requestAnimationFrame(t => this.frame(t)); }
  }
  stop() {
    if (!this.animating) return;
    this.animating = false; cancelAnimationFrame(this.raf); this.raf = null;
    this.score.className = 'll-score gameover';
    this.timeOfDay = irand(0, SKIES.length);
    this.frozen = true; setTimeout(() => { this.frozen = false; }, 250);
  }
  frame(ts) {
    if (!this.animating) return;
    if (this.tStart == null) this.tStart = ts;
    const dtMs = this.last == null ? 16 : Math.min(50, ts - this.last);
    this.last = ts;
    this.now += dtMs;
    this.step(this.now, dtMs);
    if (this.animating) this.raf = requestAnimationFrame(t => this.frame(t));
  }
  playerStep(d, dt) {
    if (d.el.hidden) return;
    if (d.boosting) d.dv = -P.BOOST_DV; else d.dv += P.G;
    if (d.dv < -P.MAX_V) d.dv = -P.MAX_V; else if (d.dv > P.MAX_V) d.dv = P.MAX_V;
    const y = d.ty + d.dv * dt;
    d.ty = y < 0 ? 0 : y;
    d.rot = 90 + lerp(clamp(rlerp(d.dv, P.MAX_V, -1 * P.MAX_V)), 90, -90);
    // prepareCheckIntersections(): map the hull through the view matrix
    const HULL = [0.3, 0, 0.7, 0, 0.92, 0.33, 0.92, 0.75, 0.6, 1, 0.4, 1, 0.08, 0.75, 0.08, 0.33];
    const inset = (P.PLAYER_SIZE - P.PLAYER_HIT_SIZE) / 2, scale = P.PLAYER_HIT_SIZE;
    const cx = d.w / 2, cy = d.h / 2, a = d.rot * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
    d.corners = [];
    for (let i = 0; i < HULL.length; i += 2) {
      const x = (scale * HULL[i] + inset - cx) * d.sx, y2 = (scale * HULL[i + 1] + inset - cy) * d.sy;
      d.corners.push(d.left + d.tx + cx + x * cos - y2 * sin, d.top + d.ty + cy + x * sin + y2 * cos);
    }
  }
  step(tMs, dtMs) {
    const t = tMs / 1000, dt = dtMs / 1000;
    this.t = t;
    // 1. Move all objects and update bounds
    for (const v of this.children) {
      v.tween(tMs);
      if (v.kind === 'player') this.playerStep(v, dt);
      else if (v.kind === 'obstacle') { v.tx -= P.TRANSLATION_PER_SEC * dt; v.hit = v.hitRect(); if (v.pop) { if (v.rotate) v.rot += dt * 45 * v.rotate; v.cx = (v.hit.left + v.hit.right) / 2 | 0; v.cy = (v.hit.top + v.hit.bottom) / 2 | 0; v.r = v.w / 2 | 0; } }
      else if (v.kind === 'scenery') v.tx -= P.TRANSLATION_PER_SEC * dt * v.v;
    }
    const d = this.droid;
    // 2. Check for altitude
    if (this.playing && d.corners.some((c, i) => i % 2 === 1 && Math.trunc(c) >= this.H)) { this.stop(); }
    // 3. Check for obstacles
    let passedBarrier = false;
    for (let j = this.obstacles.length; j-- > 0;) {
      const ob = this.obstacles[j];
      if (this.playing && this.intersects(ob, d)) this.stop();
      else if (this.cleared(ob, d)) { if (!ob.pop) passedBarrier = true; this.obstacles.splice(j, 1); }
    }
    if (this.playing && passedBarrier) this.setScore(this.mScore + 1);
    // 4. Handle edge of screen
    for (const v of this.children.slice()) {
      if (v.kind === 'obstacle' && v.tx + v.w < 0) v.remove();
      else if (v.kind === 'scenery' && v.tx + v.sw < 0) v.tx = this.W;
    }
    // 5. Time for more obstacles!
    if (this.playing && (t - this.lastPipeTime) > P.OBSTACLE_PERIOD) {
      this.lastPipeTime = t;
      const H = this.H, W = this.W;
      const obstacley = Math.trunc(Math.random() * (H - 2 * P.OBSTACLE_MIN - P.OBSTACLE_GAP)) + P.OBSTACLE_MIN;
      const inset = (P.OBSTACLE_WIDTH - P.OBSTACLE_STEM_WIDTH) / 2, yinset = P.OBSTACLE_WIDTH / 2;
      const d1 = irand(0, 250), d2 = irand(0, 250);
      const s1 = this.stem(obstacley - yinset, false); s1.tx = W + inset; s1.ty = -s1.h - yinset; s1.animate({ ty: 0 }, 250, d1);
      const p1 = this.pop(); p1.tx = W; p1.ty = -P.OBSTACLE_WIDTH; p1.sx = p1.sx * 0.25; p1.sy = 0.25; p1.animate({ ty: s1.h - inset, sx: Math.sign(p1.sx), sy: 1 }, 250, d1);
      const s2 = this.stem(H - obstacley - P.OBSTACLE_GAP - yinset, true); s2.tx = W + inset; s2.ty = H + yinset; s2.animate({ ty: H - s2.h }, 400, d2);
      const p2 = this.pop(); p2.tx = W; p2.ty = H; p2.sx = p2.sx * 0.25; p2.sy = 0.25; p2.animate({ ty: H - s2.h - yinset, sx: Math.sign(p2.sx), sy: 1 }, 400, d2);
      this.obstacles.push(s1, p1, s2, p2);
      this.droid.el.parentNode.append(this.droid.el); // keep the player on top
    }
    for (const v of this.children) v.apply();
  }
  stem(hgt, drawShadow) {
    const el = h('div.ll-stem' + (drawShadow ? '.shadow' : ''));
    el.style.setProperty('--sw', P.OBSTACLE_STEM_WIDTH + 'px');
    const s = new GView(this, el, P.OBSTACLE_STEM_WIDTH, Math.max(0, hgt));
    s.kind = 'obstacle'; s.z = P.OBSTACLE_Z * 0.75;
    return s;
  }
  pop() {
    const idx = 2 * irand(0, POPS.length / 2);
    const p = new GView(this, vector(POPS[idx], 'll-fill'), P.OBSTACLE_WIDTH, P.OBSTACLE_WIDTH);
    p.kind = 'obstacle'; p.pop = true; p.z = P.OBSTACLE_Z;
    p.sx = frand() < 0.5 ? -1 : 1;
    p.rotate = POPS[idx + 1] === 0 ? 0 : (frand() < 0.5 ? -1 : 1);
    return p;
  }
  intersects(ob, d) {
    const c = d.corners;
    for (let i = 0; i < c.length; i += 2) {
      const x = Math.trunc(c[i]), y = Math.trunc(c[i + 1]);
      if (ob.pop) { if (Math.hypot(x - ob.cx, y - ob.cy) <= ob.r) return true; }
      else if (ob.hit && x >= ob.hit.left && x < ob.hit.right && y >= ob.hit.top && y < ob.hit.bottom) return true;
    }
    return false;
  }
  cleared(ob, d) {
    if (!ob.hit) return false;
    const c = d.corners;
    for (let i = 0; i < c.length; i += 2) if (ob.hit.right >= Math.trunc(c[i])) return false;
    return true;
  }
  poke() {
    if (this.frozen) return;
    if (!this.animating) { this.reset(); this.start(true); }
    else if (!this.playing) this.start(true);
    const d = this.droid;
    d.boosting = true; d.dv = -P.BOOST_DV;
    d.cancelAnim(); d.sx = 1.25; d.sy = 1.25; d.z = P.PLAYER_Z_BOOST;
  }
  unpoke() {
    if (this.frozen || !this.animating) return;
    const d = this.droid;
    d.boosting = false;
    d.cancelAnim(); d.animate({ sx: 1, sy: 1, z: P.PLAYER_Z }, 200);
  }
}
registerApp({ id: 'lland', label: 'Lollipop Land', icon: 'home', fullscreen: true, hidden: true, colorDark: '#000' }, LLandApp);
