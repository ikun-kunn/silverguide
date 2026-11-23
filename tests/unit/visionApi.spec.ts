// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { PassThrough, Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createVisionApi, parseVisionForm, imageDimensions, readBody } from '../../server/visionApi';
import { MAX_UPLOAD_BYTES } from '@/services/ai/contract';
import { createQoderVisionProvider, sanitizeProviderResponse } from '../../server/qoderVisionProvider';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU/8AAAAASUVORK5CYII=', 'base64');
const result = { success: true, pageSummary: '服务首页', instruction: '点击预约入口。', targetLabel: '预约', boundingBox: [0.1, 0.2, 0.5, 0.6], confidence: 0.9, safetyWarning: null, errorCode: null };

async function form(image = png, type = 'image/png', question = '如何预约？') {
  const data = new FormData();
  data.set('image', new Blob([new Uint8Array(image)], { type }), 'shot.png');
  data.set('question', question);
  const req = new Request('http://localhost', { method: 'POST', body: data });
  return parseVisionForm(new Uint8Array(await req.arrayBuffer()), req.headers.get('content-type')!);
}

async function callMiddleware(api: ReturnType<typeof createVisionApi>, path = '/api/vision/analyze', options: { address?: string; forwarded?: string; contentLength?: string; question?: string } = {}) {
  const data = new FormData();
  data.set('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'shot.png');
  data.set('question', options.question ?? '如何预约？');
  const request = new Request('http://localhost', { method: 'POST', body: data });
  const input = Object.assign(Readable.from([Buffer.from(await request.arrayBuffer())]), {
    url: path, method: 'POST', headers: { 'content-type': request.headers.get('content-type'), 'x-forwarded-for': options.forwarded, 'content-length': options.contentLength }, socket: { remoteAddress: options.address ?? '127.0.0.1' },
  });
  let status = 0; let output: unknown; let headers: Record<string, string> = {};
  const response = Object.assign(new EventEmitter(), {
    destroyed: false, writableEnded: false,
    writeHead(code: number, values: Record<string, string>) { status = code; headers = values; },
    end(body: string) { output = JSON.parse(body); response.writableEnded = true; response.emit('finish'); },
  });
  const next = vi.fn();
  await api(input as unknown as IncomingMessage, response as unknown as ServerResponse, next);
  return { status, output, next, headers, input };
}

describe('M2 服务端图片和 AI 契约校验', () => {
  it('解析真实 multipart 文件并保留问题', async () => {
    const parsed = await form();
    expect(parsed.question).toBe('如何预约？');
    expect(parsed.image.mediaType).toBe('image/png');
    expect(imageDimensions(Buffer.from(parsed.image.bytes), 'image/png')).toEqual([1, 1]);
    expect((await form(png, 'image/png', '')).question).toContain('主要功能');
  });
  it('拒绝伪造 MIME、超出限制的尺寸、不支持类型和过长问题', async () => {
    await expect(form(Buffer.from('not an image'))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(form(png, 'image/svg+xml')).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    const tooWide = Buffer.from(png); tooWide.writeUInt32BE(8001, 16);
    await expect(form(tooWide)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(form(png, 'image/png', '问'.repeat(301))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
  it('过滤越界、低可信及敏感操作坐标，拒绝不完整结果', () => {
    expect(sanitizeProviderResponse({ ...result, boundingBox: [0, 0, 2, 2] }).boundingBox).toBeNull();
    expect(sanitizeProviderResponse({ ...result, confidence: 0.4 }).boundingBox).toBeNull();
    expect(sanitizeProviderResponse({ ...result, safetyWarning: '涉及付款' }).boundingBox).toBeNull();
    expect(() => sanitizeProviderResponse({ success: true })).toThrow('INVALID_MODEL_OUTPUT');
  });
  it('Provider 实现 Session、图片消息、轮询和校验（模拟上游，不消耗额度）', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: 'session-example' }))
      .mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({ status: 'idle' }))
      .mockResolvedValueOnce(Response.json({ data: [{ type: 'agent.message', content: [{ type: 'text', text: JSON.stringify(result) }] }] }));
    const provider = createQoderVisionProvider({ token: 'test-only', agentId: 'agent-example', environmentId: 'env-example', fetchImpl });
    const output = await provider.analyze(await form());
    expect(output).toEqual(result);
    // 成功后 Session 已 idle，不额外调用 cancel。
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const second = fetchImpl.mock.calls[1]?.[1];
    const payload = JSON.parse(String(second?.body));
    expect(payload.events[0].content[1].source.data).toBe(png.toString('base64'));
    expect(payload.events[0].content[0].text).toContain('如何预约？');
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).budget.type).toBe('limit');
  });
  it('上游额度不足时传回明确错误', async () => {
    const provider = createQoderVisionProvider({ token: 'test-only', agentId: 'agent-example', environmentId: 'env-example', fetchImpl: async () => new Response(null, { status: 402 }) });
    await expect(provider.analyze(await form())).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
  });
  it('异常 Session 响应不继续向上游发送图片', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: 'invalid/id' }));
    const provider = createQoderVisionProvider({ token: 'test-only', agentId: 'agent-example', environmentId: 'env-example', fetchImpl });
    await expect(provider.analyze(await form())).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('已创建的上游 Session 在中断后只执行一次取消尝试（模拟上游）', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: 'session-example' }))
      .mockResolvedValueOnce(Response.json({})).mockImplementationOnce(async () => { controller.abort(); throw new Error('aborted'); })
      .mockResolvedValueOnce(Response.json({ status: 'canceling' }, { status: 202 }));
    const provider = createQoderVisionProvider({ token: 'test-only', agentId: 'agent-example', environmentId: 'env-example', fetchImpl });
    await expect(provider.analyze(await form(), controller.signal)).rejects.toThrow('aborted');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls[3]?.[0]).toMatch(/\/sessions\/session-example\/cancel$/);
    expect(fetchImpl.mock.calls[3]?.[1]?.signal?.aborted).toBe(false);
  });
  it('同源接口在未配置时明确降级，其他页面继续走路由', async () => {
    const api = createVisionApi(null);
    expect(await callMiddleware(api)).toMatchObject({ status: 404, output: { success: false, errorCode: 'NOT_CONFIGURED' } });
    expect((await callMiddleware(api, '/practice')).next).toHaveBeenCalledOnce();
  });
  it('同源接口返回校验后的结果，限制连续请求频率', async () => {
    const analyze = vi.fn(async () => result);
    const api = createVisionApi({ id: 'test-provider', analyze });
    for (let i = 0; i < 4; i++) expect(await callMiddleware(api)).toMatchObject({ status: 200, output: result });
    expect(await callMiddleware(api)).toMatchObject({ status: 429, output: { errorCode: 'RATE_LIMITED' } });
    expect(analyze).toHaveBeenCalledTimes(4);
  });
  it('达单进程每日额度后停止调用 Provider', async () => {
    const analyze = vi.fn(async () => result);
    const api = createVisionApi({ id: 'test-provider', analyze }, 85_000, { dailyLimit: 1 });
    expect(await callMiddleware(api)).toMatchObject({ status: 200 });
    expect(await callMiddleware(api)).toMatchObject({ status: 429, output: { errorCode: 'RATE_LIMITED' } });
    expect(analyze).toHaveBeenCalledOnce();
  });
  it('可信反向代理后的不同客户端分别获得单 IP 配额，仍受全局限额保护', async () => {
    const analyze = vi.fn(async () => result);
    const api = createVisionApi({ id: 'test-provider', analyze }, 85_000, { trustedProxyCidrs: '127.0.0.1', perIpPerMinute: 1, globalPerMinute: 2 });
    expect((await callMiddleware(api, undefined, { forwarded: '192.0.2.10' })).status).toBe(200);
    expect((await callMiddleware(api, undefined, { forwarded: '192.0.2.11' })).status).toBe(200);
    expect((await callMiddleware(api, undefined, { forwarded: '192.0.2.12' })).status).toBe(429);
    expect(analyze).toHaveBeenCalledTimes(2);
  });
  it('独立限制单 IP 每日调用，同一服务器保留其他客户端的额度', async () => {
    const analyze = vi.fn(async () => result);
    const api = createVisionApi({ id: 'test-provider', analyze }, 85_000, { dailyLimit: 3, dailyPerIpLimit: 1 });
    expect((await callMiddleware(api, undefined, { address: '192.0.2.1' })).status).toBe(200);
    expect((await callMiddleware(api, undefined, { address: '192.0.2.1' })).status).toBe(429);
    expect((await callMiddleware(api, undefined, { address: '192.0.2.2' })).status).toBe(200);
    expect(analyze).toHaveBeenCalledTimes(2);
  });
  it('预先已知请求超出允许大小时停止读取并关闭连接', async () => {
    const analyze = vi.fn(async () => result);
    const response = await callMiddleware(createVisionApi({ id: 'test-provider', analyze }), undefined, { contentLength: String(MAX_UPLOAD_BYTES + 64 * 1024 + 1) });
    expect(response.status).toBe(413);
    expect(response.headers.Connection).toBe('close');
    expect(response.input.destroyed).toBe(true);
    expect(analyze).not.toHaveBeenCalled();
  });
  it('流读取器在实际数据超过限制时立即暂停并移除读取监听', async () => {
    const input = new PassThrough();
    const pending = readBody(input as unknown as IncomingMessage, new AbortController().signal, 4, 1000);
    input.write(Buffer.alloc(5));
    await expect(pending).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(input.isPaused()).toBe(true);
    expect(input.listenerCount('data')).toBe(0);
    input.destroy();
  });
  it('请求体读取期限独立于模型超时并停止读取', async () => {
    vi.useFakeTimers();
    const input = new PassThrough();
    try {
      const pending = expect(readBody(input as unknown as IncomingMessage, new AbortController().signal, 4, 10)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(11);
      await pending;
      expect(input.isPaused()).toBe(true);
      expect(input.listenerCount('data')).toBe(0);
    } finally { input.destroy(); vi.useRealTimers(); }
  });
  it('超时后取消请求并返回可重试的错误', async () => {
    const api = createVisionApi({ id: 'test-provider', analyze: (_request, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }) }, 10);
    expect(await callMiddleware(api)).toMatchObject({ status: 504, output: { errorCode: 'AI_TIMEOUT' } });
  });

  it('明确敏感问题返回固定安全提醒，不把截图发往上游', async () => {
    const analyze = vi.fn(async () => result);
    const api = createVisionApi({ id: 'test-provider', analyze });
    const response = await callMiddleware(api, undefined, { question: '怎么付款？' });
    expect(response).toMatchObject({ status: 200, output: { success: true, boundingBox: null, targetLabel: null, confidence: null,
      safetyWarning: expect.stringContaining('验证码') } });
    expect(analyze).not.toHaveBeenCalled();
  });

  it('非敏感问题的模型结果涉及敏感业务时，仅返回固定提醒', async () => {
    const api = createVisionApi({ id: 'test-provider', analyze: async () => ({ ...result, instruction: '确认付款', safetyWarning: null }) });
    const response = await callMiddleware(api);
    expect(response).toMatchObject({ status: 200, output: { targetLabel: null, boundingBox: null, confidence: null,
      instruction: expect.stringContaining('请暂停操作'), safetyWarning: expect.stringContaining('验证码') } });
    expect(JSON.stringify(response.output)).not.toContain('确认付款');
  });

  it('Provider 在超时后迟到的成功不得作为有效结果', async () => {
    const api = createVisionApi({ id: 'test-provider', analyze: async (_request, signal) => {
      await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve(), { once: true }));
      return result;
    } }, 20);
    expect(await callMiddleware(api)).toMatchObject({ status: 504, output: { errorCode: 'AI_TIMEOUT' } });
  });
});
