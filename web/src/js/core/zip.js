// Minimal ZIP reader/writer (stored + deflate) on top of the Compression Streams
// API. Runs in browsers and in Node 18+ (used by both the WAPK installer and
// web/tools/apk2wapk.mjs to read APKs).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
export const inflateRaw = bytes => pipe(bytes, new DecompressionStream('deflate-raw'));
export const deflateRaw = bytes => pipe(bytes, new CompressionStream('deflate-raw'));

const td = new TextDecoder(), te = new TextEncoder();

/** Parses the central directory. Returns { entries: Map<name, entry>, read(name) -> Promise<Uint8Array> }. */
export function readZip(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a ZIP archive');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt ZIP central directory');
    const method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const dosTime = dv.getUint16(p + 12, true), dosDate = dv.getUint16(p + 14, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
    const mtime = new Date(1980 + (dosDate >> 9), ((dosDate >> 5) & 15) - 1, dosDate & 31, dosTime >> 11, (dosTime >> 5) & 63, (dosTime & 31) * 2).getTime();
    entries.set(name, { name, method, crc, csize, size, local, mtime, dir: name.endsWith('/') });
    p += 46 + nlen + xlen + clen;
  }
  async function read(name) {
    const e = typeof name === 'string' ? entries.get(name) : name;
    if (!e) throw new Error('No such entry: ' + name);
    const lp = e.local;
    if (dv.getUint32(lp, true) !== 0x04034b50) throw new Error('Corrupt local header');
    const start = lp + 30 + dv.getUint16(lp + 26, true) + dv.getUint16(lp + 28, true);
    const raw = u8.subarray(start, start + e.csize);
    if (e.method === 0) return raw.slice();
    if (e.method === 8) return inflateRaw(raw);
    throw new Error('Unsupported ZIP method ' + e.method);
  }
  return { entries, read, async text(name) { return td.decode(await read(name)); } };
}

/** files: [{ name, data: Uint8Array|string, mtime?, store? }] -> Uint8Array */
export async function writeZip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const data = typeof f.data === 'string' ? te.encode(f.data) : f.data;
    const name = te.encode(f.name);
    let method = 0, comp = data;
    if (!f.store && data.length > 64) { const d = await deflateRaw(data); if (d.length < data.length) { method = 8; comp = d; } }
    const crc = crc32(data);
    const d = new Date(f.mtime || Date.now());
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, comp.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, comp);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true); ch.setUint32(20, comp.length, true);
    ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + comp.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let o = 0; for (const c of all) { out.set(c, o); o += c.length; }
  return out;
}

export async function sha256Hex(bytes) {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
