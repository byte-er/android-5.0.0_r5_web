// Port of frameworks/base/cmds/bootanimation/BootAnimation.cpp :: android()
// The stock AOSP animation: the "android" logo mask (android-logo-mask.png)
// over a horizontally scrolling shine texture (android-logo-shine.png).
import { asset } from '../core/assets.js';
import { h } from '../core/dom.js';

function load(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }

export async function bootAnimation(container, minMs = 3500) {
  const canvas = h('canvas.bootanim');
  container.append(canvas);
  const ctx = canvas.getContext('2d');
  let mask, shine;
  try { [mask, shine] = await Promise.all([load(asset('boot/android-logo-mask.png')), load(asset('boot/android-logo-shine.png'))]); }
  catch { await new Promise(r => setTimeout(r, minMs)); canvas.remove(); return; }
  const start = performance.now();
  let raf;
  await new Promise(resolve => {
    const frame = now => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth * dpr, hgt = container.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; }
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hgt);
      // BootAnimation draws the 512x128 mask at native size; scale it to the width of a phone.
      const scale = Math.min(w * 0.75 / mask.width, 1.2 * dpr);
      const mw = mask.width * scale, mh = mask.height * scale;
      const xc = (w - mw) / 2, yc = (hgt - mh) / 2;
      // float t = 4.0f * float(time / us2ns(16667)) / mAndroid[1].w;
      // GLint offset = (1 - (t - floorf(t))) * mAndroid[1].w;
      const time = now - start;
      const tt = 4.0 * (time / 16.667) / shine.width;
      const offset = (1 - (tt - Math.floor(tt))) * shine.width * scale;
      ctx.save();
      ctx.beginPath(); ctx.rect(xc, yc, mw, mh); ctx.clip();
      const x = xc - offset;
      ctx.drawImage(shine, x, yc, shine.width * scale, mh);
      ctx.drawImage(shine, x + shine.width * scale, yc, shine.width * scale, mh);
      ctx.restore();
      ctx.drawImage(mask, xc, yc, mw, mh);
      if (now - start < minMs) setTimeout(() => { raf = requestAnimationFrame(frame); }, 83); else resolve(); // 12fps, as in BootAnimation.cpp
    };
    raf = requestAnimationFrame(frame);
  });
  cancelAnimationFrame(raf);
  await canvas.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400 }).finished;
  canvas.remove();
}
