// @vitest-environment node
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { makeServiceWorker } from '../../build/pwa';

function setup() {
  const events = new Map<string, (event: any) => void>();
  const scope = 'https://example.test/sg/';
  const shell = new Response('APP SHELL');
  const cache = { addAll: vi.fn(async () => {}), match: vi.fn(async (url: string) => url.endsWith('index.html') ? shell : new Response('ASSET')) };
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => ['silverguide-shell:/sg/:old', 'silverguide-shell:/other/:old', 'unrelated']), delete: vi.fn(async () => true) };
  const claim = vi.fn(async () => {});
  const skipWaiting = vi.fn(async () => {});
  const fetch = vi.fn(async () => { throw new Error('offline'); });
  runInNewContext(makeServiceWorker('new', ['index.html', 'assets/app.js']), { URL, Response, caches, fetch, self: { registration: { scope }, clients: { claim }, skipWaiting, addEventListener(name: string, callback: (event: any) => void) { events.set(name, callback); } } });
  function fire(name: string, request?: { url: string; method: string; mode: string }) {
    const waitUntil = vi.fn(); const respondWith = vi.fn(); events.get(name)?.({ request, waitUntil, respondWith });
    return { waitUntil, respondWith };
  }
  function message(data: unknown) { const waitUntil = vi.fn(); events.get('message')?.({ data, waitUntil }); return waitUntil; }
  return { fire, message, cache, caches, claim, fetch, scope, skipWaiting };
}

describe('M3 Service Worker 隔离及离线策略', () => {
  it('预缓存静态白名单，只淘汰该作用域的旧版本', async () => {
    const { fire, cache, caches, claim, scope } = setup();
    await fire('install').waitUntil.mock.calls[0]?.[0];
    expect(cache.addAll).toHaveBeenCalledWith([`${scope}index.html`, `${scope}assets/app.js`]);
    await fire('activate').waitUntil.mock.calls[0]?.[0];
    expect(caches.delete).toHaveBeenCalledWith('silverguide-shell:/sg/:old');
    expect(caches.delete).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledOnce();
  });
  it('已知应用路由断网后回退到静态入口，白名单资源走缓存', async () => {
    const { fire, scope, fetch } = setup();
    const response = await fire('fetch', { url: `${scope}practice/hospital-registration`, method: 'GET', mode: 'navigate' }).respondWith.mock.calls[0]?.[0];
    expect(await response.text()).toBe('APP SHELL');
    const asset = await fire('fetch', { url: `${scope}assets/app.js`, method: 'GET', mode: 'same-origin' }).respondWith.mock.calls[0]?.[0];
    expect(await asset.text()).toBe('ASSET');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('只在收到 SKIP_WAITING 消息时接管，不自动跳过等待', () => {
    const { message, skipWaiting } = setup();
    message({ type: 'OTHER' });
    expect(skipWaiting).not.toHaveBeenCalled();
    message({ type: 'SKIP_WAITING' });
    expect(skipWaiting).toHaveBeenCalledOnce();
  });
  it('不拦截 AI API、图片上传、第三方、未知页面或运行时资源', () => {
    const { fire, scope } = setup();
    for (const [url, method, mode] of [
      [`${scope}api/vision/analyze`, 'POST', 'cors'], [`${scope}api/vision/analyze`, 'GET', 'navigate'], ['https://example.test/api/vision/analyze', 'POST', 'cors'],
      [`${scope}upload.png`, 'GET', 'same-origin'], [`${scope}unknown`, 'GET', 'navigate'], ['https://elsewhere.test/assets/app.js', 'GET', 'cors'],
    ]) expect(fire('fetch', { url, method, mode }).respondWith).not.toHaveBeenCalled();
  });
});
