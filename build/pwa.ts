import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

export const PWA_PUBLIC_ASSETS = ['manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

/** 只缓存构建产物白名单；不缓存 API、用户截图、导航响应或任意运行时请求。 */
export function makeServiceWorker(version: string, assets: string[]): string {
  return `/* Generated SilverGuide app shell. */
const scope = new URL(self.registration.scope);
const prefix = 'silverguide-shell:' + scope.pathname + ':';
const cacheName = prefix + ${JSON.stringify(version)};
const indexUrl = new URL('index.html', scope).href;
const files = ${JSON.stringify(assets)}.map(path => new URL(path, scope).href);
const allowed = new Set(files);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
    await self.clients.claim();
  })());
});
// 仅在用户确认更新后由页面显式触发，不自动跳过等待期。
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const relativePath = url.pathname.slice(scope.pathname.length);
  if (relativePath === 'api' || relativePath.startsWith('api/')) return;
  if (request.mode === 'navigate') {
    const route = relativePath.replace(/\\/$/, '');
    const appRoute = route === '' || ['practice', 'progress', 'settings', 'ai-helper', 'about'].includes(route) || /^practice\\/[^/]+$/.test(route);
    if (!appRoute) return;
    event.respondWith(fetch(request).catch(async () => {
      const cached = await (await caches.open(cacheName)).match(indexUrl);
      return cached || new Response('页面暂不可用，请联网后重试', { status: 503 });
    }));
    return;
  }
  if (!allowed.has(url.href)) return;
  event.respondWith((async () => (await (await caches.open(cacheName)).match(url.href)) || fetch(request))());
});
`;
}

export function silverguidePwaPlugin(): Plugin {
  let root = process.cwd();
  return {
    name: 'silverguide-pwa', apply: 'build', enforce: 'post',
    configResolved(config) { root = config.root; },
    generateBundle(_options, bundle) {
      const names = ['index.html', ...PWA_PUBLIC_ASSETS, ...Object.keys(bundle).filter((file) => file.startsWith('assets/'))];
      const assets = [...new Set(names)].sort();
      const hash = createHash('sha256').update(makeServiceWorker('version', assets));
      for (const asset of assets) {
        const entry = bundle[asset];
        hash.update(asset);
        if (entry?.type === 'chunk') hash.update(entry.code);
        else if (entry?.type === 'asset') hash.update(entry.source);
        else if (PWA_PUBLIC_ASSETS.includes(asset)) hash.update(readFileSync(resolve(root, 'public', asset)));
        else if (asset === 'index.html') hash.update(readFileSync(resolve(root, asset)));
      }
      this.emitFile({ type: 'asset', fileName: 'service-worker.js', source: makeServiceWorker(hash.digest('hex').slice(0, 16), assets) });
    },
  };
}
