import { describe, expect, it } from 'vitest';
import { analyzeScreenshot, resolveQuestion } from '@/services/ai/visionClient';
import type { FetchLike } from '@/services/ai/visionClient';

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const successPayload = {
  success: true,
  pageSummary: '这是医院服务首页。',
  instruction: '请点击「预约挂号」。',
  targetLabel: '预约挂号',
  boundingBox: [0.1, 0.2, 0.6, 0.32],
  confidence: 0.9,
  safetyWarning: null,
  errorCode: null,
};

function pngFile(): File {
  return new File(['dummy-image-bytes'], 'shot.png', { type: 'image/png' });
}

describe('AI 服务客户端：接口契约与降级（TRD §7.2 / §7.4 / NFR-007）', () => {
  it('按 multipart/form-data 提交 image、question、taskContext', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl: FetchLike = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return fakeResponse(successPayload);
    };

    const outcome = await analyzeScreenshot(
      { image: pngFile(), question: '我应该点哪里？', taskContext: 'hospital-registration' },
      { fetchImpl },
    );

    expect(capturedUrl).toBe('/api/vision/analyze');
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.credentials).toBe('same-origin');
    const form = capturedInit?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect((form.get('image') as File).name).toBe('shot.png');
    expect(form.get('question')).toBe('我应该点哪里？');
    expect(form.get('taskContext')).toBe('hospital-registration');
    expect(outcome.degraded).toBe(false);
    expect(outcome.errorCode).toBeNull();
    expect(outcome.analysis.status).toBe('success');
  });

  it('浏览器请求中不携带任何认证信息', async () => {
    let init: RequestInit | undefined;
    const fetchImpl: FetchLike = async (_url, requestInit) => {
      init = requestInit;
      return fakeResponse(successPayload);
    };
    await analyzeScreenshot({ image: pngFile(), question: '' }, { fetchImpl });
    expect(init?.headers).toBeUndefined();
    expect(JSON.stringify(init?.headers ?? {})).not.toMatch(/authorization|bearer|token/i);
  });

  it('未输入问题时自动改为「先解释页面主要功能」', () => {
    expect(resolveQuestion('   ')).toContain('主要功能');
    expect(resolveQuestion('我应该点哪里？')).toBe('我应该点哪里？');
  });

  it.each([
    [404, 'NOT_CONFIGURED'],
    [400, 'INVALID_REQUEST'],
    [402, 'AI_QUOTA_EXCEEDED'],
    [413, 'FILE_TOO_LARGE'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
    [429, 'RATE_LIMITED'],
    [503, 'AI_UNAVAILABLE'],
    [500, 'UNKNOWN'],
  ])('HTTP %i 映射为 %s，并给出明确降级提示', async (status, code) => {
    const fetchImpl: FetchLike = async () => fakeResponse({}, status);
    const outcome = await analyzeScreenshot({ image: pngFile(), question: '帮我看看' }, { fetchImpl });
    expect(outcome.errorCode).toBe(code);
    expect(outcome.degraded).toBe(true);
    expect(outcome.analysis.status).toBe('failed');
    expect(outcome.analysis.instruction.length).toBeGreaterThan(0);
    expect(outcome.analysis.boundingBox).toBeNull();
  });

  it('模型输出非法 JSON 结构时拒绝展示', async () => {
    const fetchImpl: FetchLike = async () => fakeResponse({ hello: 'world' });
    const outcome = await analyzeScreenshot({ image: pngFile(), question: '帮我看看' }, { fetchImpl });
    expect(outcome.errorCode).toBe('INVALID_MODEL_OUTPUT');
    expect(outcome.analysis.status).toBe('failed');
  });

  it('上传前检查失败时不发出请求', async () => {
    let called = false;
    const fetchImpl: FetchLike = async () => {
      called = true;
      return fakeResponse(successPayload);
    };
    const bad = new File(['x'], 'bad.svg', { type: 'image/svg+xml' });
    const outcome = await analyzeScreenshot({ image: bad, question: '' }, { fetchImpl });
    expect(called).toBe(false);
    expect(outcome.errorCode).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('超时返回 AI_TIMEOUT，网络异常返回 NETWORK_ERROR', async () => {
    const abortableFetch: FetchLike = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    const timeout = await analyzeScreenshot(
      { image: pngFile(), question: '' },
      { fetchImpl: abortableFetch, timeoutMs: 5 },
    );
    expect(timeout.errorCode).toBe('AI_TIMEOUT');

    const network = await analyzeScreenshot(
      { image: pngFile(), question: '' },
      { fetchImpl: async () => Promise.reject(new Error('offline')) },
    );
    expect(network.errorCode).toBe('NETWORK_ERROR');
    expect(network.degraded).toBe(true);
  });

  it('降级结果不含任何伪装成 AI 分析的页面描述', async () => {
    const fetchImpl: FetchLike = async () => fakeResponse({}, 503);
    const outcome = await analyzeScreenshot({ image: pngFile(), question: '' }, { fetchImpl });
    expect(outcome.analysis.pageSummary).toBe('');
    expect(outcome.analysis.targetLabel).toBeNull();
    expect(outcome.analysis.confidence).toBeNull();
  });
});
