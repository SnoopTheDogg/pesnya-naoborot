// Zero-dependency icon generator: node scripts/make-icons.mjs
// Draws a "rewind" mark (two left-pointing triangles) on the accent colour and writes PNGs.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BG = [0xff, 0xb0, 0x00]; // --accent
const FG = [0x1a, 0x13, 0x00]; // --accent-text
const SS = 4; // supersampling per axis

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// Triangle pointing left: tip at (tx, 0.5), base at x = tx + w, spanning h vertically (unit square).
const W = 0.27;
const H = 0.4;
const TIPS = [0.22, 0.51];
function inside(x, y) {
  for (const tx of TIPS) {
    if (x < tx || x > tx + W) continue;
    const half = ((x - tx) / W) * (H / 2);
    if (Math.abs(y - 0.5) <= half) return true;
  }
  return false;
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (inside((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size)) hits++;
        }
      }
      const t = hits / (SS * SS);
      for (let c = 0; c < 3; c++) {
        raw[row + 1 + x * 3 + c] = Math.round(BG[c] + (FG[c] - BG[c]) * t);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(join(root, name), png(size));
  console.log(`wrote ${name} (${size}x${size})`);
}
