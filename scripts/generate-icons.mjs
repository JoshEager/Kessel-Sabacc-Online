// Generates the PWA icons in client/public/icons from simple vector shapes, with no image
// dependencies (a tiny anti-aliased rasterizer + PNG encoder). Run: node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const outDir = fileURLToPath(new URL('../client/public/icons/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const BG = '#0b0e1a';
const SAND = '#e8b84a';
const BLOOD = '#d64045';
const INK = '#fdf6e3';

/** Shapes in a 512×512 design space. `rot` is in degrees around the shape's centre. */
function shapes(scale) {
  // scale < 1 shrinks the artwork towards the centre (maskable icons need a safe zone).
  const s = (v) => 256 + (v - 256) * scale;
  const card = (cx, cy, rot, fill) => [
    { type: 'rrect', cx: s(cx), cy: s(cy), w: 196 * scale, h: 284 * scale, r: 30 * scale, rot, fill },
    { type: 'rrect', cx: s(cx), cy: s(cy), w: 164 * scale, h: 252 * scale, r: 20 * scale, rot, fill: BG, alpha: 0.18 },
    { type: 'diamond', cx: s(cx), cy: s(cy), rx: 46 * scale, ry: 66 * scale, rot, fill: INK },
  ];
  return [...card(196, 262, -10, SAND), ...card(316, 250, 12, BLOOD)];
}

function hex(c) {
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
}

function inside(sh, x, y) {
  const a = (-(sh.rot ?? 0) * Math.PI) / 180;
  const dx = x - sh.cx;
  const dy = y - sh.cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  if (sh.type === 'diamond') return Math.abs(lx) / sh.rx + Math.abs(ly) / sh.ry <= 1;
  const hw = sh.w / 2 - sh.r;
  const hh = sh.h / 2 - sh.r;
  const qx = Math.max(Math.abs(lx) - hw, 0);
  const qy = Math.max(Math.abs(ly) - hh, 0);
  return Math.abs(lx) <= sh.w / 2 && Math.abs(ly) <= sh.h / 2 && qx * qx + qy * qy <= sh.r * sh.r;
}

function render(size, { scale = 1, cornerRadius = 0 } = {}) {
  const list = shapes(scale);
  const bg = hex(BG);
  const SS = 4; // 4×4 supersampling
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, cover = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const X = ((x + (sx + 0.5) / SS) / size) * 512;
          const Y = ((y + (sy + 0.5) / SS) / size) * 512;
          if (cornerRadius > 0) {
            const bgShape = { type: 'rrect', cx: 256, cy: 256, w: 512, h: 512, r: cornerRadius };
            if (!inside(bgShape, X, Y)) continue;
          }
          let col = [...bg];
          for (const sh of list) {
            if (!inside(sh, X, Y)) continue;
            const c = hex(sh.fill);
            const al = sh.alpha ?? 1;
            col = col.map((v, i) => v * (1 - al) + c[i] * al);
          }
          r += col[0]; g += col[1]; b += col[2]; cover++;
        }
      }
      const o = (y * size + x) * 4;
      const n = SS * SS;
      if (cover > 0) {
        px[o] = Math.round(r / cover);
        px[o + 1] = Math.round(g / cover);
        px[o + 2] = Math.round(b / cover);
      }
      px[o + 3] = Math.round((cover / n) * 255);
    }
  }
  return encodePng(size, size, px);
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = {
  'icon-192.png': render(192, { cornerRadius: 96 }),
  'icon-512.png': render(512, { cornerRadius: 96 }),
  // Maskable: full-bleed background, artwork inside the central 80% safe zone.
  'maskable-512.png': render(512, { scale: 0.78 }),
  // iOS rounds the corners itself and ignores transparency, so keep it full-bleed.
  'apple-touch-icon.png': render(180, { scale: 0.9 }),
  'favicon-32.png': render(32, { cornerRadius: 96 }),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(outDir + name, data);
  console.log(`wrote client/public/icons/${name} (${data.length} bytes)`);
}
