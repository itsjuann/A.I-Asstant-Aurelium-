// Generates assets/icon.png (256x256) and assets/icon.ico with no external libraries.
// The icon: a blue contour ring with a warm gold core, matching the entity.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const px = Buffer.alloc(SIZE * SIZE * 4);
const cx = SIZE / 2, cy = SIZE / 2;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = (x - cx) / (SIZE / 2), dy = (y - cy) / (SIZE / 2);
    const d = Math.sqrt(dx * dx + dy * dy);
    let r = 0, g = 0, b = 0, a = 0;
    // background disc
    if (d < 0.98) { r = 2; g = 6; b = 16; a = 255; }
    // contour rings (blue)
    for (const ring of [0.86, 0.72, 0.58]) {
      const w = Math.abs(d - ring);
      if (w < 0.035) {
        const k = 1 - w / 0.035;
        r = Math.min(255, r + 30 * k); g = Math.min(255, g + 120 * k); b = Math.min(255, b + 255 * k);
      }
    }
    // warm core
    if (d < 0.42) {
      const k = Math.pow(1 - d / 0.42, 1.4);
      r = Math.min(255, r + 255 * k); g = Math.min(255, g + 150 * k); b = Math.min(255, b + 40 * k);
    }
    // soft anti-aliased edge
    if (d > 0.94 && d < 0.98) a = Math.round(255 * (1 - (d - 0.94) / 0.04));
    const i = (y * SIZE + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  }
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) { raw[y * (SIZE * 4 + 1)] = 0; px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4); }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
]);

// ICO container holding the PNG (supported since Windows Vista).
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0; entry[2] = 0; entry[3] = 0; entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(22, 12);
const ico = Buffer.concat([header, entry, png]);

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), png);
fs.writeFileSync(path.join(out, 'icon.ico'), ico);
console.log('Wrote assets/icon.png and assets/icon.ico');
