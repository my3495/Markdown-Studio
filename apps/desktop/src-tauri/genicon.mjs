import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const SIZE = 512;
const R = 45, G = 85, B = 255; // 主题蓝

function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}

function makePNG(size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const off = y * (size * 4 + 1);
    raw[off] = 0;
    for (let x = 0; x < size; x++) {
      const p = off + 1 + x * 4;
      raw[p] = R; raw[p + 1] = G; raw[p + 2] = B; raw[p + 3] = 255;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function makeICO(png) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type icon
  dir.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 256 -> 0
  entry[1] = 0; // height
  entry[2] = 0; // colors
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bit count
  entry.writeUInt32LE(png.length, 8); // bytes in res
  entry.writeUInt32LE(22, 12); // offset
  return Buffer.concat([dir, entry, png]);
}

const out = path.join(process.cwd(), 'icons');
fs.mkdirSync(out, { recursive: true });
const png = makePNG(SIZE);
fs.writeFileSync(path.join(out, 'icon.png'), png);
fs.writeFileSync(path.join(out, 'icon.ico'), makeICO(png));
// 额外提供 Tauri 常用尺寸
fs.writeFileSync(path.join(out, '32x32.png'), makePNG(32));
fs.writeFileSync(path.join(out, '128x128.png'), makePNG(128));
fs.writeFileSync(path.join(out, '128x128@2x.png'), makePNG(256));
// 占位 Source 供后续 tauri icon 使用
fs.writeFileSync(path.join(out, 'icon-maskable.png'), makePNG(1024));
console.log('icons generated:', fs.readdirSync(out).join(', '));
