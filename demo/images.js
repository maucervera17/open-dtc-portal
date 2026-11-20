// Placeholder images for the local demo: deterministic abstract PNGs, generated in memory (no files, no network, no real media).
import { deflateSync, crc32 } from 'node:zlib';

const SIZE = 480;
const cache = new Map();

function hash(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function hsl(h, s, l) {
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function render(name) {
  const seed = hash(name);
  const hue = seed % 360;
  const top = hsl(hue, 0.55, 0.72), bottom = hsl((hue + 40) % 360, 0.6, 0.45), accent = hsl((hue + 180) % 360, 0.5, 0.86);
  const shape = (seed >> 9) % 3;
  const cx = SIZE * (0.35 + ((seed >> 4) % 30) / 100), cy = SIZE * (0.4 + ((seed >> 12) % 20) / 100), r = SIZE * (0.16 + ((seed >> 16) % 10) / 100);
  const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE);
  let p = 0;
  for (let y = 0; y < SIZE; y++) {
    raw[p++] = 0;
    for (let x = 0; x < SIZE; x++) {
      const t = (y / SIZE) * 0.7 + (x / SIZE) * 0.3;
      let px = [0, 1, 2].map(i => top[i] + (bottom[i] - top[i]) * t);
      const dx = x - cx, dy = y - cy;
      const inside = shape === 0 ? dx * dx + dy * dy < r * r
        : shape === 1 ? Math.abs(dx) + Math.abs(dy) < r * 1.2
          : Math.abs(dx) < r * 1.1 && Math.abs(dy) < r * 0.8;
      if (inside) px = px.map((v, i) => v * 0.25 + accent[i] * 0.75);
      else if (y > SIZE * 0.86 && (x + y) % 48 < 6) px = px.map(v => v * 0.9 + 25);
      raw[p++] = Math.max(0, Math.min(255, Math.round(px[0])));
      raw[p++] = Math.max(0, Math.min(255, Math.round(px[1])));
      raw[p++] = Math.max(0, Math.min(255, Math.round(px[2])));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0); header.writeUInt32BE(SIZE, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// Same name, same picture.
export function placeholderPng(name) {
  if (!cache.has(name)) cache.set(name, render(name));
  return cache.get(name);
}
