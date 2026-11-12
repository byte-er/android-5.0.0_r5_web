// APK metadata reader: Android binary XML (AXML) and resources.arsc parsers,
// following frameworks/base/include/androidfw/ResourceTypes.h. Isomorphic
// (browser + Node) so both web/tools/apk2wapk.mjs and the on-device
// package installer can use it.
import { readZip, sha256Hex } from './zip.js';

const RES_STRING_POOL = 0x0001, RES_TABLE = 0x0002, RES_XML = 0x0003;
const RES_XML_START_ELEMENT = 0x0102, RES_XML_END_ELEMENT = 0x0103, RES_XML_RESOURCE_MAP = 0x0180;
const RES_TABLE_PACKAGE = 0x0200, RES_TABLE_TYPE = 0x0201;
const TYPE_REFERENCE = 0x01, TYPE_STRING = 0x03, TYPE_INT_BOOLEAN = 0x12;
// android.R.attr ids, used when attribute names are stripped by obfuscators
const ATTR_IDS = { 0x01010001: 'label', 0x01010002: 'icon', 0x01010003: 'name', 0x0101020c: 'minSdkVersion', 0x01010270: 'targetSdkVersion',
  0x01010271: 'maxSdkVersion', 0x0101021b: 'versionCode', 0x0101021c: 'versionName', 0x01010199: 'drawable', 0x01010000: 'theme' };

function stringPool(dv, u8, start) {
  const count = dv.getUint32(start + 8, true), flags = dv.getUint32(start + 16, true);
  const stringsStart = dv.getUint32(start + 20, true), headerSize = dv.getUint16(start + 2, true);
  const utf8 = (flags & 0x100) !== 0;
  const td8 = new TextDecoder('utf-8'), td16 = new TextDecoder('utf-16le');
  const cache = new Array(count);
  const get = i => {
    if (i < 0 || i >= count || i === 0xFFFFFFFF) return null;
    if (cache[i] !== undefined) return cache[i];
    let p = start + stringsStart + dv.getUint32(start + headerSize + i * 4, true);
    let s;
    if (utf8) {
      let n = u8[p++]; if (n & 0x80) p++;               // UTF-16 length (unused)
      let len = u8[p++]; if (len & 0x80) len = ((len & 0x7F) << 8) | u8[p++];
      s = td8.decode(u8.subarray(p, p + len));
    } else {
      let len = dv.getUint16(p, true); p += 2;
      if (len & 0x8000) { len = ((len & 0x7FFF) << 16) | dv.getUint16(p, true); p += 2; }
      s = td16.decode(u8.subarray(p, p + len * 2));
    }
    return (cache[i] = s);
  };
  return { count, get };
}

/** Parses compiled XML into { name, attrs: { name: { type, data, string } }, children: [] } */
export function parseAXML(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint16(0, true) !== RES_XML) throw new Error('Not a binary XML file');
  let p = dv.getUint16(2, true), strings = null, resMap = [];
  const root = { name: '#document', attrs: {}, children: [] }, stack = [root];
  while (p < u8.length) {
    const type = dv.getUint16(p, true), hsize = dv.getUint16(p + 2, true), size = dv.getUint32(p + 4, true);
    if (type === RES_STRING_POOL) strings = stringPool(dv, u8, p);
    else if (type === RES_XML_RESOURCE_MAP) for (let i = p + hsize; i < p + size; i += 4) resMap.push(dv.getUint32(i, true));
    else if (type === RES_XML_START_ELEMENT) {
      const name = strings.get(dv.getUint32(p + 20, true));
      const attrStart = dv.getUint16(p + 24, true), attrSize = dv.getUint16(p + 26, true), attrCount = dv.getUint16(p + 28, true);
      const el = { name, attrs: {}, children: [] };
      for (let i = 0; i < attrCount; i++) {
        const a = p + hsize + attrStart + i * attrSize;
        const ni = dv.getUint32(a + 4, true);
        let an = strings.get(ni);
        if ((!an || !/^[a-zA-Z]/.test(an)) && resMap[ni]) an = ATTR_IDS[resMap[ni]] || '0x' + resMap[ni].toString(16);
        const raw = dv.getUint32(a + 8, true), vtype = u8[a + 15], data = dv.getUint32(a + 16, true);
        el.attrs[an] = { type: vtype, data, string: raw !== 0xFFFFFFFF ? strings.get(raw) : vtype === TYPE_STRING ? strings.get(data) : null };
      }
      stack[stack.length - 1].children.push(el);
      stack.push(el);
    } else if (type === RES_XML_END_ELEMENT) stack.pop();
    if (!size) break;
    p += size;
  }
  return root.children[0];
}

/** Parses resources.arsc; returns { resolve(id, cfg) } */
export function parseARSC(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint16(0, true) !== RES_TABLE) throw new Error('Not a resource table');
  let p = dv.getUint16(2, true), globalStrings = null;
  const entries = new Map(); // id -> [{ config, value }]
  const packages = [];
  while (p < u8.length) {
    const type = dv.getUint16(p, true), size = dv.getUint32(p + 4, true);
    if (type === RES_STRING_POOL) globalStrings = stringPool(dv, u8, p);
    else if (type === RES_TABLE_PACKAGE) {
      const pkgId = dv.getUint32(p + 8, true);
      const name = new TextDecoder('utf-16le').decode(u8.subarray(p + 12, p + 12 + 256)).replace(/\0.*$/s, '');
      packages.push({ id: pkgId, name });
      const typeStrings = stringPool(dv, u8, p + dv.getUint32(p + 268, true));
      let q = p + dv.getUint16(p + 2, true);
      while (q < p + size) {
        const ct = dv.getUint16(q, true), chs = dv.getUint16(q + 2, true), cs = dv.getUint32(q + 4, true);
        if (ct === RES_TABLE_TYPE) {
          const typeId = u8[q + 8], flags = u8[q + 9], count = dv.getUint32(q + 12, true), entriesStart = dv.getUint32(q + 16, true);
          const c = q + 20;
          const config = { density: dv.getUint16(c + 14, true), sdk: dv.getUint16(c + 24, true), lang: String.fromCharCode(u8[c + 8], u8[c + 9]).replace(/\0/g, ''),
            uiMode: dv.getUint32(c, true) >= 32 ? u8[c + 29] : 0, sw: dv.getUint32(c, true) >= 32 ? dv.getUint16(c + 30, true) : 0, typeName: typeStrings.get(typeId - 1) };
          const sparse = flags & 0x01, off16 = flags & 0x02;
          for (let i = 0; i < count; i++) {
            let idx = i, off;
            if (sparse) { idx = dv.getUint16(q + chs + i * 4, true); off = dv.getUint16(q + chs + i * 4 + 2, true) * 4; }
            else if (off16) { off = dv.getUint16(q + chs + i * 2, true); if (off === 0xFFFF) continue; off *= 4; }
            else { off = dv.getUint32(q + chs + i * 4, true); if (off === 0xFFFFFFFF) continue; }
            const e = q + entriesStart + off;
            const eflags = dv.getUint16(e + 2, true);
            let value = null;
            if (eflags & 0x08) value = { type: u8[e + 3], data: dv.getUint32(e + 4, true) }; // compact entry
            else if (!(eflags & 0x01)) { const v = e + dv.getUint16(e, true); value = { type: u8[v + 3], data: dv.getUint32(v + 4, true) }; }
            if (!value) continue;
            const id = ((pkgId & 0xFF) << 24) | (typeId << 16) | idx;
            if (!entries.has(id >>> 0)) entries.set(id >>> 0, []);
            entries.get(id >>> 0).push({ config, value });
          }
        }
        if (!cs) break;
        q += cs;
      }
    }
    if (!size) break;
    p += size;
  }
  // Best match for a device: API level, density, phone UI mode, default/English locale
  function pick(list, { sdk = 21, density = 640, lang = 'en' } = {}) {
    const ok = list.filter(({ config: c }) => (!c.sdk || c.sdk <= sdk) && ((c.uiMode & 0x0F) <= 1) && (!c.lang || c.lang === lang) && (!c.sw || c.sw <= 400) && c.density !== 0xFFFE && c.density !== 0xFFFF);
    const score = c => (c.lang === lang ? 1e6 : 0) + (c.density ? (c.density >= density ? 1e5 - c.density : c.density) : 1) + (c.sdk || 0);
    return ok.sort((a, b) => score(b.config) - score(a.config))[0] || list[0];
  }
  function resolve(id, cfg, depth = 0) {
    const list = entries.get(id >>> 0);
    if (!list || depth > 8) return null;
    const best = pick(list, cfg);
    const v = best.value;
    if (v.type === TYPE_REFERENCE) return resolve(v.data, cfg, depth + 1);
    if (v.type === TYPE_STRING) return { type: 'string', value: globalStrings.get(v.data), config: best.config };
    if (v.type >= 0x1c && v.type <= 0x1f) return { type: 'color', value: '#' + (v.data >>> 0).toString(16).padStart(8, '0'), config: best.config };
    return { type: 'value', value: v.data, config: best.config };
  }
  return { resolve, packages, entryCount: entries.size };
}

/** Reads an APK and returns its metadata + icon bytes (as Android 5.0 would choose them). */
export async function readApk(bytes, cfg = { sdk: 21, density: 640 }) {
  const zip = readZip(bytes);
  const manifest = parseAXML(await zip.read('AndroidManifest.xml'));
  const arsc = zip.entries.has('resources.arsc') ? parseARSC(await zip.read('resources.arsc')) : null;
  const attr = (el, n) => el && el.attrs[n];
  const str = a => {
    if (!a) return null;
    if (a.type === TYPE_REFERENCE && arsc) { const r = arsc.resolve(a.data, cfg); return r ? r.value : null; }
    if (a.type === TYPE_INT_BOOLEAN) return a.data !== 0;
    return a.string != null ? a.string : a.data;
  };
  const sdkEl = manifest.children.find(c => c.name === 'uses-sdk');
  const app = manifest.children.find(c => c.name === 'application');
  const perms = manifest.children.filter(c => c.name === 'uses-permission').map(c => str(attr(c, 'name'))).filter(Boolean);
  let launchable = null;
  for (const a of (app ? app.children : []).filter(c => c.name === 'activity' || c.name === 'activity-alias')) {
    const isMain = a.children.some(f => f.name === 'intent-filter' && f.children.some(x => x.name === 'action' && str(attr(x, 'name')) === 'android.intent.action.MAIN')
      && f.children.some(x => x.name === 'category' && str(attr(x, 'name')) === 'android.intent.category.LAUNCHER'));
    if (isMain) { launchable = str(attr(a, 'name')); break; }
  }
  let iconPath = null, icon = null;
  const iconAttr = attr(app, 'icon');
  if (iconAttr && arsc) { const r = arsc.resolve(iconAttr.data, cfg); if (r && r.type === 'string' && /\.(png|webp|jpg)$/i.test(r.value)) iconPath = r.value; }
  if (iconPath && zip.entries.has(iconPath)) icon = await zip.read(iconPath);
  const dex = [...zip.entries.keys()].filter(n => /^classes\d*\.dex$/.test(n));
  const abis = [...new Set([...zip.entries.keys()].filter(n => n.startsWith('lib/')).map(n => n.split('/')[1]))];
  return {
    package: attr(manifest, 'package')?.string,
    versionCode: Number(str(attr(manifest, 'versionCode'))) || 0,
    versionName: String(str(attr(manifest, 'versionName')) ?? ''),
    minSdkVersion: Number(str(attr(sdkEl, 'minSdkVersion'))) || 1,
    targetSdkVersion: Number(str(attr(sdkEl, 'targetSdkVersion'))) || 0,
    label: String(str(attr(app, 'label')) ?? ''),
    permissions: [...new Set(perms)],
    launchableActivity: launchable,
    iconPath, icon,
    dexFiles: dex, nativeAbis: abis,
    sha256: await sha256Hex(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
  };
}
