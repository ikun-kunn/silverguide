import { readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createVisionApi } from './visionApi';
import { readVisionConfig } from './config';

const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json; charset=utf-8' };
const appPages = new Set(['/', '/practice', '/progress', '/settings', '/ai-helper', '/about']);

/** 只允许静态构建白名单和明确的 SPA 路由，未知 API 和文件不回退到 HTML。 */
export function resolveStaticAsset(pathname: string, files: ReadonlySet<string>): string | null {
  if (files.has(pathname)) return pathname;
  const route = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (appPages.has(route) || /^\/practice\/[^/.]+$/.test(route)) return '/index.html';
  return null;
}

function publicFiles(root: string): Set<string> {
  const files = new Set<string>();
  for (const name of ['index.html', 'service-worker.js', 'manifest.webmanifest']) {
    if (statSync(join(root, name), { throwIfNoEntry: false })?.isFile()) files.add(`/${name}`);
  }
  for (const directory of ['assets', 'icons']) {
    const path = join(root, directory);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) throw new Error('构建产物不完整，请先执行 npm run build');
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isFile() && contentTypes[extname(entry.name)]) files.add(`/${directory}/${entry.name}`);
    }
  }
  if (!files.has('/index.html') || !files.has('/service-worker.js')) throw new Error('构建产物不完整，请先执行 npm run build');
  return files;
}

/** Node 20+ 同源运行载体，不依赖 Vite 开发服务器；只读取 dist 静态产物。 */
export function createAppRuntime(root: string, config = readVisionConfig()) {
  const files = publicFiles(root);
  const vision = createVisionApi(config.provider, 85_000, config);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      let passToStatic = false;
      await vision(req, res, () => { passToStatic = true; });
      if (!passToStatic || res.writableEnded || res.destroyed) return;
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }); res.end(); return;
      }
      const target = resolveStaticAsset(pathname, files);
      if (!target || !files.has(target)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end('页面不存在'); return;
      }
      const bytes = await readFile(join(root, target.slice(1)));
      res.writeHead(200, {
        'Content-Type': contentTypes[extname(target)] ?? 'application/octet-stream',
        'Content-Length': bytes.length,
        'Cache-Control': target.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      // 只记录固定操作名与异常类别，不输出路径、请求内容、堆栈或凭证。
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.warn('[SilverGuide]', 'runtime.static', { errorType: /^[A-Za-z]+Error$/.test(name) ? name : 'UnknownError' });
      if (!res.destroyed && !res.writableEnded) {
        if (!res.headersSent) res.writeHead(500, { 'Cache-Control': 'no-store' });
        res.end();
      }
    }
  };
}
