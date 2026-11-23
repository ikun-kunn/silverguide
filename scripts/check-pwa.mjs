/** 构建后检查图标尺寸、manifest、预缓存清单和所有实际文件。 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'));
const worker = readFileSync(join(dist, 'service-worker.js'), 'utf8');
assert.ok(html.includes('manifest.webmanifest') && html.includes('apple-touch-icon'));
assert.equal(manifest.display, 'standalone');
for (const size of [180, 192, 512]) {
  const png = readFileSync(join(dist, `icons/icon-${size}.png`));
  assert.equal(png.subarray(12, 16).toString(), 'IHDR');
  assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
}
const match = worker.match(/const files = (\[[^\r\n]+\])\.map/);
assert.ok(match, '缺少预缓存清单');
const assets = JSON.parse(match[1]);
assert.ok(assets.includes('index.html') && assets.includes('manifest.webmanifest'));
assert.ok(assets.some((name) => /^assets\/.*\.js$/.test(name)));
assert.ok(assets.some((name) => /^assets\/.*\.css$/.test(name)));
for (const name of assets) {
  assert.ok(/^(index\.html|manifest\.webmanifest|icons\/icon-\d+\.png|assets\/[\w.-]+)$/.test(name), `非预期缓存文件：${name}`);
  assert.ok(existsSync(join(dist, name)), `缺少构建文件：${name}`);
}
console.log(`PWA 产物检查通过：${assets.length} 个静态文件，PNG 安装图标及 manifest 完整。`);
