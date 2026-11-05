/**
 * TRD §6.5 ScreenshotAnalysis 与 §7.2 /api/vision/analyze 接口契约。
 * 注意：接口响应中的 boundingBox 是「不可信原始值」，只有经过
 * aiResponseValidator 校验后才会成为 ScreenshotAnalysis.boundingBox。
 */

export const VISION_ERROR_CODES = [
  'NOT_CONFIGURED',
  'INVALID_REQUEST',
  'UNSUPPORTED_MEDIA_TYPE',
  'FILE_TOO_LARGE',
  'INVALID_MODEL_OUTPUT',
  'AI_TIMEOUT',
  'AI_UNAVAILABLE',
  'AI_QUOTA_EXCEEDED',
  'RATE_LIMITED',
  'NETWORK_ERROR',
  'UNKNOWN',
] as const;

export type VisionErrorCode = (typeof VISION_ERROR_CODES)[number];

export type AnalysisStatus = 'success' | 'uncertain' | 'failed';

/** [x1, y1, x2, y2]，0~1 归一化坐标，且 x1 < x2、y1 < y2 */
export type BoundingBox = readonly [number, number, number, number];

/** TRD §6.5：AI 分析结果（客户端领域模型） */
export interface ScreenshotAnalysis {
  id: string;
  pageSummary: string;
  instruction: string;
  targetLabel: string | null;
  boundingBox: BoundingBox | null;
  confidence: number | null;
  safetyWarning: string | null;
  status: AnalysisStatus;
}

/** TRD §7.2：multipart/form-data 请求 */
export interface VisionAnalyzeRequest {
  image: Blob;
  question: string;
  taskContext?: string;
}

/** TRD §7.2：统一 JSON 响应 */
export interface VisionAnalyzeResponse {
  success: boolean;
  pageSummary: string;
  instruction: string;
  targetLabel: string | null;
  /** 原始坐标，number[] | null；未校验，不得直接用于绘制 */
  boundingBox: number[] | null;
  confidence: number | null;
  safetyWarning: string | null;
  errorCode: VisionErrorCode | null;
}

/**
 * 客户端调用结果包装。ScreenshotAnalysis 严格保持 §6.5 字段不变，
 * 诊断信息与「是否为降级结果」放在外层。
 */
export interface VisionAnalysisOutcome {
  analysis: ScreenshotAnalysis;
  errorCode: VisionErrorCode | null;
  /** true 表示 AI 服务不可用/超时/网络异常，并非模型输出 */
  degraded: boolean;
}
