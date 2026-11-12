// Converts Android VectorDrawable XML (as used throughout AOSP 5.0) to SVG.
// Supports <vector>, <group> (rotation/pivot/scale/translate), <path>
// (fillColor/strokeColor/strokeWidth/fillAlpha/strokeAlpha) and <clip-path>.

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/android:([a-zA-Z]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

function color(c, fallback = '#fff') {
  if (!c) return null;
  if (c.startsWith('@')) return fallback; // resource reference: tinted at runtime
  let h = c.slice(1);
  if (h.length === 3) h = h.split('').map(x => x + x).join('');
  if (h.length === 4) h = h.split('').map(x => x + x).join('');
  if (h.length === 6) return '#' + h;
  if (h.length === 8) {
    const a = parseInt(h.slice(0, 2), 16) / 255;
    return a >= 1 ? '#' + h.slice(2) : `rgba(${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${parseInt(h.slice(6, 8), 16)},${+a.toFixed(3)})`;
  }
  return fallback;
}

const num = v => parseFloat(String(v).replace(/dp|dip|px/, ''));

// Android's PathParser accepts arc flags written as floats ("1.000000"); SVG
// requires single 0/1 digits. Re-serialise every A/a command.
export function normalizePath(d) {
  if (!/[aA]/.test(d)) return d;
  const toks = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  let out = '', cmd = '', args = [];
  const flush = () => {
    if (!cmd) return;
    if (cmd === 'a' || cmd === 'A') {
      for (let i = 0; i + 7 <= args.length; i += 7) {
        const a = args.slice(i, i + 7); if (a.length < 7) break;
        out += (i === 0 ? cmd : ' ') + `${a[0]},${a[1]} ${a[2]} ${+a[3] ? 1 : 0},${+a[4] ? 1 : 0} ${a[5]},${a[6]}`;
      }
    } else out += cmd + args.join(' ');
    cmd = ''; args = [];
  };
  for (const t of toks) { if (/[a-zA-Z]/.test(t)) { flush(); cmd = t; if (/[zZ]/.test(t)) { out += t; cmd = ''; } } else args.push(t); }
  flush();
  return out;
}

export function vectorToSvg(xml, { currentColor = false } = {}) {
  xml = xml.replace(/<!--[\s\S]*?-->/g, '');
  if (!/<vector[\s>]/.test(xml)) return null;
  let out = '';
  let vb = null, w = 24, h = 24, idc = 0;
  const tokens = xml.matchAll(/<(\/?)(vector|group|path|clip-path)\b([^>]*?)(\/?)>/g);
  for (const [, close, name, body, selfClose] of tokens) {
    if (close) { if (name === 'group') out += '</g>'; continue; }
    const a = attrs(body);
    if (name === 'vector') {
      w = num(a.width || 24); h = num(a.height || 24);
      vb = `0 0 ${num(a.viewportWidth || w)} ${num(a.viewportHeight || h)}`;
      if (a.alpha) out += `<g opacity="${a.alpha}">`;
      continue;
    }
    if (name === 'group') {
      const px = num(a.pivotX || 0), py = num(a.pivotY || 0);
      const t = [];
      const tx = num(a.translateX || 0) + px, ty = num(a.translateY || 0) + py;
      if (tx || ty) t.push(`translate(${tx} ${ty})`);
      if (a.rotation) t.push(`rotate(${num(a.rotation)})`);
      if (a.scaleX || a.scaleY) t.push(`scale(${num(a.scaleX || 1)} ${num(a.scaleY || 1)})`);
      if (px || py) t.push(`translate(${-px} ${-py})`);
      out += t.length ? `<g transform="${t.join(' ')}">` : '<g>';
      if (selfClose) out += '</g>';
      continue;
    }
    if (name === 'clip-path') {
      const id = 'c' + (idc++);
      out += `<clipPath id="${id}"><path d="${normalizePath(a.pathData)}"/></clipPath><g clip-path="url(#${id})">`;
      // closes with the parent group; approximate by leaving open until end
      continue;
    }
    if (name === 'path') {
      const fill = a.fillColor ? (currentColor ? 'currentColor' : color(a.fillColor)) : 'none';
      let p = `<path d="${normalizePath(a.pathData)}" fill="${fill}"`;
      if (currentColor && a.fillColor) {
        const c = color(a.fillColor);
        const m = c && c.match(/rgba\([^)]*,([\d.]+)\)$/);
        if (m) p += ` fill-opacity="${m[1]}"`;
      }
      if (a.fillAlpha) p += ` fill-opacity="${a.fillAlpha}"`;
      if (a.strokeColor) p += ` stroke="${currentColor ? 'currentColor' : color(a.strokeColor)}" stroke-width="${a.strokeWidth || 1}"`;
      if (a.strokeAlpha) p += ` stroke-opacity="${a.strokeAlpha}"`;
      if (a.strokeLineCap) p += ` stroke-linecap="${a.strokeLineCap}"`;
      if (a.strokeLineJoin) p += ` stroke-linejoin="${a.strokeLineJoin}"`;
      out += p + '/>';
    }
  }
  const opens = (out.match(/<g[\s>]/g) || []).length, closes = (out.match(/<\/g>/g) || []).length;
  out += '</g>'.repeat(Math.max(0, opens - closes));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}">${out}</svg>`;
}
