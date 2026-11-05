import { DEFAULT_TIMEOUT_MS, VISION_ENDPOINT } from '@/services/ai/contract';
import { validateVisionResponse } from '@/services/aiResponseValidator';
import { checkImageFile, extensionFor } from '@/services/imageService';
import type {
  ScreenshotAnalysis,
  VisionAnalysisOutcome,
  VisionAnalyzeRequest,
  VisionErrorCode,
} from '@/types/vision';
import { createId } from '@/utils/id';

/**
 * TRD §5.2：浏览器只访问同源 /api/vision/analyze，由受保护的服务端适配层
 * 负责持有凭证并调用 Cloud Agents。此文件不含任何认证信息，
 * 也不会在请求头中携带令牌。
 */
export const VISION_FAILURE_MESSAGES: Record<VisionErrorCode, string> = {
  NOT_CONFIGURED: 'AI 看图服务尚未接入，暂时不能使用。模拟训练不受影响。',
  INVALID_REQUEST: '提交的内容不完整，请重新选择截图后再试。',
  UNSUPPORTED_MEDIA_TYPE: '只支持 PNG、JPEG、WebP、GIF 格式的图片。',
  FILE_TOO_LARGE: '图片超过 5MB，请选择更小的截图。',
  INVALID_MODEL_OUTPUT: 'AI 服务暂时无法给出可靠的指引，请稍后重试。模拟训练仍可正常使用。',
  AI_TIMEOUT: 'AI 分析超时，请稍后重试。模拟训练仍可正常使用。',
  AI_UNAVAILABLE: 'AI 服务暂不可用，请稍后重试。模拟训练仍可正常使用。',
  AI_QUOTA_EXCEEDED: 'AI 服务额度不足，请稍后再试。模拟训练仍可正常使用。',
  RATE_LIMITED: '请求太频繁，请稍等一会再试。',
  NETWORK_ERROR: '网络连接中断，请检查网络后重试。模拟训练仍可正常使用。',
  UNKNOWN: 'AI 服务返回了未知错误，请稍后重试。',
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface VisionClientOptions {
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}

function failed(code: VisionErrorCode): VisionAnalysisOutcome {
  const analysis: ScreenshotAnalysis = {
    id: createId('analysis'),
    pageSummary: '',
    // 系统提示，不是 AI 生成内容，也不伪装成实时分析结果（TRD §FR-401）
    instruction: VISION_FAILURE_MESSAGES[code],
    targetLabel: null,
    boundingBox: null,
    confidence: null,
    safetyWarning: null,
    status: 'failed',
  };
  return { analysis, errorCode: code, degraded: true };
}

function mapHttpStatus(status: number): VisionErrorCode {
  if (status === 404) return 'NOT_CONFIGURED';
  if (status === 400 || status === 422) return 'INVALID_REQUEST';
  if (status === 402) return 'AI_QUOTA_EXCEEDED';
  if (status === 413) return 'FILE_TOO_LARGE';
  if (status === 415) return 'UNSUPPORTED_MEDIA_TYPE';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 502 || status === 503 || status === 504) return 'AI_UNAVAILABLE';
  return 'UNKNOWN';
}

/** TRD §3.5：未输入问题时，要求先解释界面主要功能 */
export function resolveQuestion(question: string): string {
  return question.trim().length > 0
    ? question
    : '请先用一两句话说明这个页面的主要功能，暂时不要给出操作步骤。';
}

export async function analyzeScreenshot(
  request: VisionAnalyzeRequest,
  options: VisionClientOptions = {},
): Promise<VisionAnalysisOutcome> {
  const precheck = checkImageFile(request.image);
  if (!precheck.ok) {
    return failed(precheck.code ?? 'INVALID_REQUEST');
  }

  const endpoint = options.endpoint ?? VISION_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl: FetchLike | undefined = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return failed('NETWORK_ERROR');
  }

  const form = new FormData();
  const filename =
    typeof File !== 'undefined' && request.image instanceof File && request.image.name
      ? request.image.name
      : `screenshot.${extensionFor(request.image.type)}`;
  form.append('image', request.image, filename);
  form.append('question', resolveQuestion(request.question));
  if (request.taskContext !== undefined && request.taskContext !== '') {
    form.append('taskContext', request.taskContext);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = (): void => controller.abort();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
      signal: controller.signal,
    });

    if (!response.ok) {
      return failed(mapHttpStatus(response.status));
    }

    let raw: unknown;
    try {
      raw = (await response.json()) as unknown;
    } catch {
      return failed('INVALID_MODEL_OUTPUT');
    }

    const validation = validateVisionResponse(raw);
    if (!validation.ok) {
      return failed(validation.errorCode ?? 'INVALID_MODEL_OUTPUT');
    }
    return { analysis: validation.analysis, errorCode: null, degraded: false };
  } catch {
    if (timedOut) return failed('AI_TIMEOUT');
    if (options.signal?.aborted) return failed('NETWORK_ERROR');
    return failed('NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}
