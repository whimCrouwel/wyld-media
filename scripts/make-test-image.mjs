// 検証用: 2400x1800 のグラデーション PNG を生成する(依存なし)。
// 長辺が 1600 を超えるので、エディタのリサイズ・WebP 圧縮経路を必ず通る。
import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const W = 2400, H = 1800;

const crcTable = [...Array(256)].map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // color type: RGB

const rows = Buffer.alloc(H * (1 + W * 3)); // 行頭 1 byte はフィルタ(0)
for (let y = 0; y < H; y++) {
  const off = y * (1 + W * 3);
  for (let x = 0; x < W; x++) {
    rows[off + 1 + x * 3] = (x * 255 / W) | 0;
    rows[off + 1 + x * 3 + 1] = (y * 255 / H) | 0;
    rows[off + 1 + x * 3 + 2] = 96;
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(rows)),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync('test-cover.png', png);
console.log(`wrote test-cover.png (${W}x${H}, ${png.length} bytes)`);
