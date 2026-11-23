// @vitest-environment node
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createAppRuntime, resolveStaticAsset } from '../../server/appRuntime';
import { readVisionConfig } from '../../server/config';

describe('M3 同源生产运行载体', () => {
  const root = fileURLToPath(new URL('../fixtures/runtime/', import.meta.url));
  const handle = createAppRuntime(root, readVisionConfig({}));
  async function request(url: string, method = 'GET') {
    let status = 0; let headers: Record<string, unknown> = {}; let body = '';
    const res = Object.assign(new EventEmitter(), {
      destroyed: false, writableEnded: false, headersSent: false,
      writeHead(code: number, values: Record<string, unknown>) { status = code; headers = values; this.headersSent = true; },
      end(data?: string | Buffer) { body = data?.toString() ?? ''; this.writableEnded = true; },
    });
    await handle({ url, method, headers: {} } as IncomingMessage, res as unknown as ServerResponse);
    return { status, headers, body };
  }
  it('深层 SPA 路由提供入口，更新敏感资源不长缓存', async () => {
    expect(await request('/practice/taxi-ride')).toMatchObject({ status: 200, headers: { 'Cache-Control': 'no-cache' }, body: expect.stringContaining('APP SHELL') });
    expect(await request('/service-worker.js')).toMatchObject({ status: 200, headers: { 'Cache-Control': 'no-cache' } });
    expect(await request('/assets/demo.js', 'HEAD')).toMatchObject({ status: 200, body: '', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } });
  });
  it('未知文件和接口不回退到 HTML，未接入接口明确降级', async () => {
    expect((await request('/not-found')).status).toBe(404);
    expect((await request('/api/unknown')).status).toBe(404);
    const ai = await request('/api/vision/analyze', 'POST');
    expect(ai.status).toBe(404);
    expect(JSON.parse(ai.body).errorCode).toBe('NOT_CONFIGURED');
    expect((await request('/not-found', 'POST')).status).toBe(405);
    expect(resolveStaticAsset('/server/index.mjs', new Set(['/index.html']))).toBeNull();
  });
  it('服务端缺失或不安全配置时不创建 Provider，合理限制每日额度', () => {
    expect(readVisionConfig({}).provider).toBeNull();
    expect(readVisionConfig({ QODER_ACCESS_TOKEN: 'test', QODER_VISION_AGENT_ID: 'a', QODER_VISION_ENVIRONMENT_ID: 'e', QODER_API_BASE_URL: 'http://example.invalid' }).provider).toBeNull();
    expect(readVisionConfig({ SILVERGUIDE_DAILY_AI_LIMIT: '20' }).dailyLimit).toBe(20);
    expect(readVisionConfig({ SILVERGUIDE_DAILY_AI_LIMIT: '0' }).dailyLimit).toBe(50);
    expect(readVisionConfig({ SILVERGUIDE_VISION_GLOBAL_PER_MINUTE: '80', SILVERGUIDE_VISION_PER_IP_PER_MINUTE: '6', SILVERGUIDE_DAILY_AI_PER_IP_LIMIT: '12', SILVERGUIDE_VISION_BODY_TIMEOUT_MS: '5000' })).toMatchObject({ globalPerMinute: 80, perIpPerMinute: 6, dailyPerIpLimit: 12, bodyTimeoutMs: 5000 });
    expect(readVisionConfig({ SILVERGUIDE_VISION_GLOBAL_PER_MINUTE: '0', SILVERGUIDE_VISION_BODY_TIMEOUT_MS: '999999' })).toMatchObject({ globalPerMinute: 60, bodyTimeoutMs: 15000 });
  });
});
