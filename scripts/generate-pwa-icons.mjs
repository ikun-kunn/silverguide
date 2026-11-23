/** 生成确定性的 PNG 图标；仅依赖 Node，圆角手机 + 绿色/黄色引导标志。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const output = fileURLToPath(new URL('../public/icons/', import.meta.url));
mkdirSync(output, { recursive: true });

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(data.length);
  const suffix = Buffer.alloc(4); suffix.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([prefix, name, data, suffix]);
}
function rounded(x, y, left, top, right, bottom, radius) {
  const dx = Math.max(left + radius - x, x - right + radius, 0);
  const dy = Math.max(top + radius - y, y - bottom + radius, 0);
  return dx * dx + dy * dy <= radius * radius;
}
function segmentDistance(x, y, ax, ay, bx, by) {
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
}
function pixel(x, y) {
  const blue = [29, 78, 216];
  const white = [255, 255, 255];
  // 主要内容位于 maskable 安全区域内。
  if (rounded(x, y, 0.27, 0.18, 0.73, 0.82, 0.10)) {
    if (rounded(x, y, 0.31, 0.25, 0.69, 0.75, 0.055)) {
      if (Math.hypot(x - 0.50, y - 0.50) < 0.155) {
        if (Math.min(segmentDistance(x, y, 0.42, 0.5, 0.48, 0.56), segmentDistance(x, y, 0.48, 0.56, 0.58, 0.44)) < 0.021) return blue;
        return [255, 219, 0];
      }
      return [239, 246, 255];
    }
    return white;
  }
  return blue;
}
function render(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const colors = [[0.25, 0.25], [0.25, 0.75], [0.75, 0.25], [0.75, 0.75]].map(([dx, dy]) => pixel((x + dx) / size, (y + dy) / size));
      for (let c = 0; c < 3; c++) raw[y * (size * 3 + 1) + 1 + x * 3 + c] = Math.round(colors.reduce((sum, color) => sum + color[c], 0) / 4);
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const size of [180, 192, 512]) writeFileSync(join(output, `icon-${size}.png`), render(size));
console.log('生成 PWA 图标：180、192、512 px');
