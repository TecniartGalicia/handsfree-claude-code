// Generates media/icon.png (128×128) and media/icon.svg without any dependency.
// Design: Argalla navy tile, a turquoise "prompt" chevron and a blue cursor bar — "the prompt keeps
// moving on its own". Rendered with signed-distance functions at 4× and box-downsampled.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PNG = path.join(ROOT, 'media', 'icon.png');
const OUT_SVG = path.join(ROOT, 'media', 'icon.svg');

const SIZE = 128;
const SS = 4; // supersampling
const NAVY = [0x0f, 0x17, 0x2a];
const TURQ = [0x2d, 0xd4, 0xbf];
const BLUE = [0x3b, 0x82, 0xf6];

// geometry in 128-unit space
const RADIUS = 28;
const STROKE = 13;
const CHEV = { a: [38, 40], b: [64, 64], c: [38, 88] }; // ">" shape
const BAR = { a: [70, 88], b: [96, 88] };

const sdRoundRect = (x, y, w, h, r) => {
  const qx = Math.abs(x - w / 2) - (w / 2 - r);
  const qy = Math.abs(y - h / 2) - (h / 2 - r);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
};
const sdSegment = (px, py, [ax, ay], [bx, by]) => {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(wx - t * vx, wy - t * vy);
};

const W = SIZE * SS;
const rgba = new Uint8ClampedArray(W * W * 4);
for (let j = 0; j < W; j++) {
  for (let i = 0; i < W; i++) {
    const x = (i + 0.5) / SS, y = (j + 0.5) / SS;
    let r = 0, g = 0, b = 0, a = 0;
    if (sdRoundRect(x, y, SIZE, SIZE, RADIUS) <= 0) {
      [r, g, b] = NAVY; a = 255;
      const dChev = Math.min(sdSegment(x, y, CHEV.a, CHEV.b), sdSegment(x, y, CHEV.b, CHEV.c));
      if (dChev <= STROKE / 2) [r, g, b] = TURQ;
      if (sdSegment(x, y, BAR.a, BAR.b) <= STROKE / 2) [r, g, b] = BLUE;
    }
    const o = (j * W + i) * 4;
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
  }
}
// box downsample (premultiplied to keep clean edges)
const px = new Uint8Array(SIZE * SIZE * 4);
for (let j = 0; j < SIZE; j++) {
  for (let i = 0; i < SIZE; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sj = 0; sj < SS; sj++) for (let si = 0; si < SS; si++) {
      const o = ((j * SS + sj) * W + (i * SS + si)) * 4;
      const al = rgba[o + 3] / 255;
      r += rgba[o] * al; g += rgba[o + 1] * al; b += rgba[o + 2] * al; a += al;
    }
    const n = SS * SS;
    const o = (j * SIZE + i) * 4;
    if (a > 0) { px[o] = Math.round(r / a); px[o + 1] = Math.round(g / a); px[o + 2] = Math.round(b / a); }
    px[o + 3] = Math.round((a / n) * 255);
  }
}

// --- PNG encoder ---
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let j = 0; j < SIZE; j++) { raw[j * (SIZE * 4 + 1)] = 0; Buffer.from(px.buffer, j * SIZE * 4, SIZE * 4).copy(raw, j * (SIZE * 4 + 1) + 1); }
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
fs.mkdirSync(path.dirname(OUT_PNG), { recursive: true });
fs.writeFileSync(OUT_PNG, png);

const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="${hex(NAVY)}"/>
  <polyline points="${CHEV.a.join(',')} ${CHEV.b.join(',')} ${CHEV.c.join(',')}" fill="none" stroke="${hex(TURQ)}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="${BAR.a[0]}" y1="${BAR.a[1]}" x2="${BAR.b[0]}" y2="${BAR.b[1]}" stroke="${hex(BLUE)}" stroke-width="${STROKE}" stroke-linecap="round"/>
</svg>
`;
fs.writeFileSync(OUT_SVG, svg);
console.log(`wrote ${OUT_PNG} (${png.length} bytes) and ${OUT_SVG}`);
