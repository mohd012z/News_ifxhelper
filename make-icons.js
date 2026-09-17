/* make-icons.js - generate the app icons as real PNG files (no dependencies).
 * Draws the XAU//DESK mark: dark panel + gold chart line + bars.
 * Run: node make-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, 'icons');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

/* ---------- minimal PNG encoder ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- tiny raster helpers ---------- */
function blend(buf, w, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= w || y >= buf.length / (w * 4)) return;
  if (a <= 0) return;
  const i = (y * w + x) * 4;
  const sa = a / 255, da = buf[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  buf[i]     = Math.round((r * sa + buf[i]     * da * (1 - sa)) / oa);
  buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / oa);
  buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / oa);
  buf[i + 3] = Math.round(oa * 255);
}
function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/* ---------- draw the icon ---------- */
function drawIcon(size, pad) {
  const buf = Buffer.alloc(size * size * 4, 0);
  const inner = size * (1 - pad * 2);
  const x0 = size * pad, y0 = size * pad;

  // rounded dark panel with a subtle top-down gradient
  const rad = size * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = true;
      const cx = x < rad ? rad : (x > size - rad ? size - rad : x);
      const cy = y < rad ? rad : (y > size - rad ? size - rad : y);
      if (Math.hypot(x - cx, y - cy) > rad) inside = false;
      if (!inside) continue;
      const t = y / size;
      const r = Math.round(11 + t * 8), g = Math.round(18 + t * 12), b = Math.round(30 + t * 18);
      blend(buf, size, x, y, r, g, b, 255);
    }
  }

  const GOLD = [226, 176, 74];
  const TEAL = [111, 211, 199];

  // gold bars (volume motif)
  const bars = [[0.16, 0.30], [0.34, 0.45], [0.52, 0.24]];
  bars.forEach(([bx, bh]) => {
    const bw = inner * 0.11, px = x0 + inner * bx, py = y0 + inner * (1 - bh);
    for (let y = py; y < y0 + inner; y++) for (let x = px; x < px + bw; x++) blend(buf, size, Math.round(x), Math.round(y), GOLD[0], GOLD[1], GOLD[2], 210);
  });

  // gold rising line
  const pts = [[0.10, 0.72], [0.28, 0.58], [0.44, 0.64], [0.62, 0.38], [0.80, 0.26], [0.94, 0.14]]
    .map(([a, b]) => [x0 + inner * a, y0 + inner * b]);
  const hw = Math.max(2, size * 0.045);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let d = Infinity;
      for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distToSeg(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
      if (d < hw + 1) {
        const a = d <= hw ? 255 : Math.round(255 * (1 - (d - hw)));
        blend(buf, size, x, y, GOLD[0], GOLD[1], GOLD[2], a);
      }
    }
  }
  // teal end-cap dot
  const last = pts[pts.length - 1], dotR = size * 0.052;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - last[0], y - last[1]);
    if (d < dotR + 1) blend(buf, size, x, y, TEAL[0], TEAL[1], TEAL[2], d <= dotR ? 255 : Math.round(255 * (1 - (d - dotR))));
  }
  return buf;
}

const targets = [
  ['icon-192.png', 192, 0.14],
  ['icon-512.png', 512, 0.14],
  ['icon-maskable-512.png', 512, 0.26],
  ['apple-touch-icon-180.png', 180, 0.12],
  ['favicon-32.png', 32, 0.10]
];
targets.forEach(([name, size, pad]) => {
  const buf = drawIcon(size, pad);
  fs.writeFileSync(path.join(OUT, name), encodePNG(size, size, buf));
  console.log('wrote icons/' + name + ' (' + size + 'x' + size + ')');
});
console.log('done: ' + targets.length + ' icons');
