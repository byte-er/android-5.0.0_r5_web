// Resolves resources extracted from the AOSP tree at build time.
const MAP = (typeof window !== 'undefined' && window.__ASSETS__) || {};
export const asset = key => MAP[key] || null;
export const hasAsset = key => key in MAP;
export const listAssets = prefix => Object.keys(MAP).filter(k => k.startsWith(prefix)).sort();
export async function fetchBytes(key) {
  const u = asset(key);
  if (!u) throw new Error('missing asset ' + key);
  const res = await fetch(u);
  if (!res.ok) throw new Error('fetch failed ' + key);
  return res.arrayBuffer();
}
