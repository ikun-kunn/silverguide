import { VISION_ERROR_CODES } from '@/types/vision';
import type {
  AnalysisStatus,
  BoundingBox,
  ScreenshotAnalysis,
  VisionErrorCode,
} from '@/types/vision';
import { isNormalizedBoundingBox } from '@/utils/coordinates';
import { createId } from '@/utils/id';

/**
 * TRD §5.3 aiResponseValidator / §7.2 输出校验 / §7.3-8 / §FR-202。
 * 原则：
 * 1. 结构性错误（JSON 非法、字段缺失、类型错误）→ status=failed，不展示任何指引。
 * 2. 坐标非法或置信度不足 → status=uncertain，隐藏位置标注，仅保留文字指导。
 * 3. 任何情况下都不得输出超出 [0,1] 的坐标。
 */
export const MIN_CONFIDENCE_FOR_BOX = 0.6;
export const MAX_TEXT_LENGTH = 1000;

export const INVALID_OUTPUT_MESSAGE =
  'AI 服务暂时无法给出可靠的指引，请稍后重试。模拟训练仍可正常使用。';

export interface ValidationResult {
  ok: boolean;
  analysis: ScreenshotAnalysis;
  /** 致命结构问题 */
  issues: string[];
  /** 非致命问题（例如坐标非法），会导致降级为 uncertain */
  warnings: string[];
  errorCode: VisionErrorCode | null;
}

function isVisionErrorCode(value: unknown): value is VisionErrorCode {
  return (
    typeof value === 'string' && (VISION_ERROR_CODES as readonly string[]).includes(value)
  );
}

function emptyAnalysis(instruction: string): ScreenshotAnalysis {
  return {
    id: createId('analysis'),
    pageSummary: '',
    instruction,
    targetLabel: null,
    boundingBox: null,
    confidence: null,
    safetyWarning: null,
    status: 'failed',
  };
}

function failed(
  instruction: string,
  issues: string[],
  errorCode: VisionErrorCode,
): ValidationResult {
  return {
    ok: false,
    analysis: emptyAnalysis(instruction),
    issues,
    warnings: [],
    errorCode,
  };
}

function readRequiredText(value: unknown, field: string, issues: string[]): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push(`${field} 必须是非空字符串`);
    return null;
  }
  if (value.length > MAX_TEXT_LENGTH) {
    issues.push(`${field} 超过长度上限`);
    return null;
  }
  return value;
}

function readNullableText(value: unknown, field: string, issues: string[]): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    issues.push(`${field} 必须是字符串或 null`);
    return null;
  }
  if (value.length > MAX_TEXT_LENGTH) {
    issues.push(`${field} 超过长度上限`);
    return null;
  }
  return value;
}

function readConfidence(value: unknown, issues: string[]): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    issues.push('confidence 必须是 0~1 的数字或 null');
    return null;
  }
  return value;
}

function readBoundingBox(value: unknown, warnings: string[]): BoundingBox | null {
  if (value === null || value === undefined) return null;
  if (!isNormalizedBoundingBox(value)) {
    warnings.push('boundingBox 非法或超出 0~1 边界，已隐藏位置标注');
    return null;
  }
  return value;
}

export function validateVisionResponse(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return failed(INVALID_OUTPUT_MESSAGE, ['响应必须是 JSON 对象'], 'INVALID_MODEL_OUTPUT');
  }

  const source = raw as Record<string, unknown>;
  if (typeof source.success !== 'boolean') {
    return failed(INVALID_OUTPUT_MESSAGE, ['success 必须是布尔值'], 'INVALID_MODEL_OUTPUT');
  }
  if (source.success !== true) {
    const code = isVisionErrorCode(source.errorCode) ? source.errorCode : 'AI_UNAVAILABLE';
    return failed(INVALID_OUTPUT_MESSAGE, [`服务返回 success=false（${code}）`], code);
  }

  const issues: string[] = [];
  const warnings: string[] = [];
  const pageSummary = readRequiredText(source.pageSummary, 'pageSummary', issues);
  const instruction = readRequiredText(source.instruction, 'instruction', issues);
  const targetLabel = readNullableText(source.targetLabel, 'targetLabel', issues);
  const safetyWarning = readNullableText(source.safetyWarning, 'safetyWarning', issues);
  const confidence = readConfidence(source.confidence, issues);
  const boundingBox = readBoundingBox(source.boundingBox, warnings);

  if (issues.length > 0 || pageSummary === null || instruction === null) {
    return failed(INVALID_OUTPUT_MESSAGE, issues, 'INVALID_MODEL_OUTPUT');
  }

  const reliable =
    confidence !== null && confidence >= MIN_CONFIDENCE_FOR_BOX && warnings.length === 0;
  const status: AnalysisStatus = reliable ? 'success' : 'uncertain';

  const analysis: ScreenshotAnalysis = {
    id: createId('analysis'),
    pageSummary,
    instruction,
    targetLabel,
    // 不确定时隐藏位置标注，仅保留文字指导（TRD §3.6 / §3.5）
    boundingBox: reliable ? boundingBox : null,
    confidence,
    safetyWarning,
    status,
  };

  return { ok: true, analysis, issues: [], warnings, errorCode: null };
}

/** 模型返回的文本需先按严格 JSON Schema 解析，解析失败不得当作可信指引 */
export function parseVisionResponse(text: string): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return failed(INVALID_OUTPUT_MESSAGE, ['响应不是合法 JSON'], 'INVALID_MODEL_OUTPUT');
  }
  return validateVisionResponse(raw);
}
