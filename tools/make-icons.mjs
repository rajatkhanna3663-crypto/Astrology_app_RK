// Generates simple PNG app icons (no dependencies): node tools/make-icons.mjs
import zlib from 'node:zlib'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const b = Buffer.alloc(8 + d.length + 4); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const t = (x + y) / (2 * size);
      let r = 15 + 60 * t, g = 18 + 40 * t, b = 50 + 140 * t;
      const d = Math.hypot(x - c, y - c) / size;
      const ring = Math.abs(d - 0.30) < 0.012, ring2 = Math.abs(d - 0.18) < 0.008;
      const ang = Math.atan2(y - c, x - c);
      const planet = Math.hypot(x - (c + 0.30 * size * Math.cos(-0.8)), y - (c + 0.30 * size * Math.sin(-0.8))) < size * 0.045;
      const sun = d < 0.075;
      if (ring || ring2) { r = 190; g = 195; b = 255; }
      if (sun) { r = 255; g = 209; b = 102; }
      if (planet) { r = 255; g = 255; b = 255; }
      void ang; raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
fs.mkdirSync(out, { recursive: true });
for (const s of [180, 192, 512]) fs.writeFileSync(path.join(out, `icon-${s}.png`), png(s));
console.log('icons written to', out);
