import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_UPLOAD_BYTES, CLOUD_AGENT_MAX_DIMENSION, VISION_ENDPOINT, SUPPORTED_IMAGE_MEDIA_TYPES } from '../src/services/ai/contract';
import type { AiVisionProvider, ServerVisionRequest, SupportedImageMediaType } from '../src/services/ai/contract';
import type { VisionAnalyzeResponse, VisionErrorCode } from '../src/types/vision';
import { sanitizeProviderResponse, VisionServiceError } from './qoderVisionProvider';
import { createTrustedProxyMatcher, resolveClientAddress } from './clientAddress';
import { hasSensitiveVisionContent, sensitiveVisionAnalysis } from '../src/services/aiResponseValidator';

const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;
const minute = 60_000;
export interface VisionApiOptions {
  dailyLimit?: number;
  dailyPerIpLimit?: number;
  publicOrigin?: string;
  trustedProxyCidrs?: string;
  perIpPerMinute?: number;
  globalPerMinute?: number;
  maxConcurrent?: number;
  maxConcurrentPerIp?: number;
  bodyTimeoutMs?: number;
}
const httpCodes: Record<VisionErrorCode, number> = {
  NOT_CONFIGURED: 404, INVALID_REQUEST: 400, UNSUPPORTED_MEDIA_TYPE: 415, FILE_TOO_LARGE: 413,
  INVALID_MODEL_OUTPUT: 502, AI_TIMEOUT: 504, AI_UNAVAILABLE: 503, AI_QUOTA_EXCEEDED: 402,
  RATE_LIMITED: 429, NETWORK_ERROR: 503, UNKNOWN: 500,
};

function failure(code: VisionErrorCode): VisionAnalyzeResponse {
  return { success: false, pageSummary: '', instruction: '', targetLabel: null, boundingBox: null, confidence: null, safetyWarning: null, errorCode: code };
}

/** 限制实际读入字节数及上传时间，无论是否有 Content-Length。 */
export function readBody(req: IncomingMessage, signal: AbortSignal, maxBytes = MAX_REQUEST_BYTES, timeoutMs = 15_000): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => fail(new VisionServiceError('AI_TIMEOUT')), timeoutMs);
    function cleanup(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      req.removeListener('data', onData); req.removeListener('end', onEnd);
      req.removeListener('error', onError); req.removeListener('aborted', onAbort);
    }
    function fail(error: unknown): void {
      if (settled) return;
      settled = true; chunks.length = 0;
      req.pause(); cleanup();
      // 关闭连接时可能有后续流错误；不再次处理、不输出原始内容。
      req.once('error', () => {});
      reject(error);
    }
    function onAbort(): void { fail(new Error('aborted')); }
    function onError(error: Error): void { fail(error); }
    function onData(chunk: Buffer): void {
      if (settled) return;
      if (size + chunk.length > maxBytes) { fail(new VisionServiceError('FILE_TOO_LARGE')); return; }
      size += chunk.length; chunks.push(chunk);
    }
    function onEnd(): void {
      if (settled) return;
      settled = true; cleanup(); resolve(new Uint8Array(Buffer.concat(chunks, size)));
    }
    req.once('error', onError); req.once('aborted', onAbort); req.once('end', onEnd);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) { onAbort(); return; }
    req.on('data', onData);
  });
}

/** 先停止接收，再尝试送出错误响应；随后关闭连接，避免异常上传继续占用资源。 */
function closeIncompleteRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.readableEnded || req.destroyed || typeof req.pause !== 'function') return;
  req.pause();
  const close = () => {
    clearTimeout(timer); res.removeListener('finish', close); res.removeListener('close', close);
    if (!req.destroyed) { req.once('error', () => {}); req.destroy(); }
  };
  const timer = setTimeout(close, 1000);
  timer.unref();
  res.once('finish', close); res.once('close', close);
}

/** 检查真实图片头和尺寸，不只相信客户端提供的 MIME 类型。 */
export function imageDimensions(data: Buffer, mediaType: SupportedImageMediaType): [number, number] | null {
  if (mediaType === 'image/png' && data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.toString('ascii', 12, 16) === 'IHDR') {
    return [data.readUInt32BE(16), data.readUInt32BE(20)];
  }
  if (mediaType === 'image/gif' && data.length >= 10 && /^GIF8[79]a$/.test(data.toString('ascii', 0, 6))) {
    return [data.readUInt16LE(6), data.readUInt16LE(8)];
  }
  if (mediaType === 'image/webp' && data.length >= 30 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    const kind = data.toString('ascii', 12, 16);
    if (kind === 'VP8X') return [1 + data.readUIntLE(24, 3), 1 + data.readUIntLE(27, 3)];
    if (kind === 'VP8L' && data[20] === 0x2f) {
      const bits = data.readUInt32LE(21); return [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)];
    }
    if (kind === 'VP8 ' && data.subarray(23, 26).equals(Buffer.from([0x9d, 1, 0x2a]))) return [data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff];
  }
  if (mediaType === 'image/jpeg' && data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= data.length && data[offset] === 0xff) {
      const marker = data[offset + 1];
      if (marker === 0xff) { offset++; continue; }
      if (marker === 0xd9 || marker === 0xda) break;
      const size = data.readUInt16BE(offset + 2);
      if (size < 2 || offset + 2 + size > data.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 7) {
        return [data.readUInt16BE(offset + 7), data.readUInt16BE(offset + 5)];
      }
      offset += size + 2;
    }
  }
  return null;
}

export async function parseVisionForm(body: Uint8Array, contentType: string): Promise<ServerVisionRequest> {
  if (body.byteLength > MAX_REQUEST_BYTES) throw new VisionServiceError('FILE_TOO_LARGE');
  if (!/^multipart\/form-data\s*;/i.test(contentType)) throw new VisionServiceError('INVALID_REQUEST');
  let form: FormData;
  try { form = await new Request('http://localhost/', { method: 'POST', headers: { 'Content-Type': contentType }, body: new Uint8Array(body) }).formData(); }
  catch { throw new VisionServiceError('INVALID_REQUEST'); }
  const image = form.get('image');
  const question = form.get('question');
  const context = form.get('taskContext');
  if (form.getAll('image').length !== 1 || typeof image === 'string' || !image || !image.size ||
      typeof question !== 'string' || question.length > 300 || (context !== null && (typeof context !== 'string' || context.length > 100))) {
    throw new VisionServiceError('INVALID_REQUEST');
  }
  if (image.size > MAX_UPLOAD_BYTES) throw new VisionServiceError('FILE_TOO_LARGE');
  if (!(SUPPORTED_IMAGE_MEDIA_TYPES as readonly string[]).includes(image.type)) throw new VisionServiceError('UNSUPPORTED_MEDIA_TYPE');
  const bytes = Buffer.from(await image.arrayBuffer());
  const mediaType = image.type as SupportedImageMediaType;
  const dimensions = imageDimensions(bytes, mediaType);
  if (!dimensions || dimensions.some((value) => value <= 0 || value > CLOUD_AGENT_MAX_DIMENSION)) throw new VisionServiceError('INVALID_REQUEST');
  return { image: { bytes, mediaType }, question: question.trim() || '请先解释这个页面的主要功能。', taskContext: context?.trim() || null };
}

export function createVisionApi(provider: AiVisionProvider | null, timeoutMs = 85_000, options: VisionApiOptions = {}) {
  let windowStart = Date.now();
  let total = 0;
  let active = 0;
  const counts = new Map<string, number>();
  const activeByIp = new Map<string, number>();
  const dailyCounts = new Map<string, number>();
  let dayStart = Date.now();
  let dailyUsed = 0;
  const dailyLimit = options.dailyLimit ?? 50;
  const dailyPerIpLimit = options.dailyPerIpLimit ?? 20;
  const perIpPerMinute = options.perIpPerMinute ?? 4;
  const globalPerMinute = options.globalPerMinute ?? 60;
  const maxConcurrent = options.maxConcurrent ?? 4;
  const maxConcurrentPerIp = options.maxConcurrentPerIp ?? 1;
  const trusted = createTrustedProxyMatcher(options.trustedProxyCidrs);
  const bodyTimeoutMs = options.bodyTimeoutMs ?? 15_000;
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    if (req.url?.split('?')[0] !== VISION_ENDPOINT) { next(); return; }
    function send(code: number, body: VisionAnalyzeResponse, closeConnection = false): void {
      if (res.destroyed || res.writableEnded) return;
      if (closeConnection) closeIncompleteRequest(req, res);
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(closeConnection ? { Connection: 'close' } : {}) });
      res.end(JSON.stringify(body));
    }
    function reject(code: VisionErrorCode): void { send(httpCodes[code], failure(code), !req.readableEnded); }
    const acceptedOrigin = options.publicOrigin ? [options.publicOrigin] : [`http://${req.headers.host}`, `https://${req.headers.host}`];
    if (req.method !== 'POST' || (req.headers.origin && !acceptedOrigin.includes(req.headers.origin))) { reject('INVALID_REQUEST'); return; }
    if (!provider) { reject('NOT_CONFIGURED'); return; }
    if (Number(req.headers['content-length']) > MAX_REQUEST_BYTES) { reject('FILE_TOO_LARGE'); return; }
    if (Date.now() - windowStart >= minute) { windowStart = Date.now(); total = 0; counts.clear(); }
    const client = resolveClientAddress(req.socket.remoteAddress, req.headers['x-forwarded-for'], trusted);
    if (Date.now() - dayStart >= 24 * 60 * minute) { dayStart = Date.now(); dailyUsed = 0; dailyCounts.clear(); }
    if (dailyUsed >= dailyLimit || (dailyCounts.get(client) ?? 0) >= dailyPerIpLimit) { reject('RATE_LIMITED'); return; }
    const count = counts.get(client) ?? 0;
    const clientActive = activeByIp.get(client) ?? 0;
    if (total >= globalPerMinute || count >= perIpPerMinute || active >= maxConcurrent || clientActive >= maxConcurrentPerIp) { reject('RATE_LIMITED'); return; }
    total++; counts.set(client, count + 1); active++;
    activeByIp.set(client, clientActive + 1);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const close = () => controller.abort();
    res.once('close', close);
    try {
      const body = await readBody(req, controller.signal, MAX_REQUEST_BYTES, bodyTimeoutMs);
      const request = await parseVisionForm(body, req.headers['content-type'] ?? '');
      controller.signal.throwIfAborted();
      if (hasSensitiveVisionContent(request.question, request.taskContext)) {
        const safe = sensitiveVisionAnalysis();
        // 明确的敏感请求无需向上游发送图片或消耗模型额度。
        send(200, { success: true, pageSummary: safe.pageSummary, instruction: safe.instruction,
          targetLabel: null, boundingBox: null, confidence: null, safetyWarning: safe.safetyWarning, errorCode: null });
        return;
      }
      if (Date.now() - dayStart >= 24 * 60 * minute) { dayStart = Date.now(); dailyUsed = 0; dailyCounts.clear(); }
      // 仅计入实际准备发往 Provider 的请求，不把格式错误计入每日额度。
      const clientDaily = dailyCounts.get(client) ?? 0;
      if (dailyUsed >= dailyLimit || clientDaily >= dailyPerIpLimit) { reject('RATE_LIMITED'); return; }
      dailyUsed++;
      dailyCounts.set(client, clientDaily + 1);
      const output = await provider.analyze(request, controller.signal);
      controller.signal.throwIfAborted();
      send(200, sanitizeProviderResponse(output, request.question, request.taskContext));
    } catch (error) {
      const code = error instanceof VisionServiceError ? error.code : controller.signal.aborted ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE';
      // 仅记录错误码，不输出截图、问题、令牌、堆栈或客户端地址。
      console.warn('[SilverGuide]', 'vision.analyze', { errorCode: code });
      reject(code);
    } finally {
      clearTimeout(timer); res.removeListener('close', close); active--;
      const remaining = (activeByIp.get(client) ?? 1) - 1;
      if (remaining <= 0) activeByIp.delete(client); else activeByIp.set(client, remaining);
    }
  };
}
