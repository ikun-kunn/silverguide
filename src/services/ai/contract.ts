import type { VisionAnalyzeResponse } from '@/types/vision';

/**
 * TRD §7.2：应用内部拟定的接口路径。浏览器只访问这个同源路径，
 * 由服务端适配层负责调用需要私密令牌的 Cloud Agents。
 */
export const VISION_ENDPOINT = '/api/vision/analyze';

/** TRD §7.4 / NFR-004：客户端超时 */
export const DEFAULT_TIMEOUT_MS = 90_000;

/** TRD §7.2：初期上传单张图片建议不超过 5MB */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** 与 Cloud Agents image source.media_type 对齐 */
export const SUPPORTED_IMAGE_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export type SupportedImageMediaType = (typeof SUPPORTED_IMAGE_MEDIA_TYPES)[number];

/** Cloud Agents 对 base64 图片的限制（官方文档：10 MiB 编码文本、单边 8000px） */
export const CLOUD_AGENT_BASE64_LIMIT_BYTES = 10 * 1024 * 1024;
export const CLOUD_AGENT_MAX_DIMENSION = 8000;

/**
 * TRD §16-6：AI 服务层预留可替换的 Provider 接口。
 * 该接口只允许在「服务端运行时」实现，不得由浏览器直接实现或注入凭证。
 */
export interface ServerVisionRequest {
  image: {
    bytes: Uint8Array;
    mediaType: SupportedImageMediaType;
  };
  question: string;
  taskContext: string | null;
}

export interface AiVisionProvider {
  readonly id: string;
  analyze(request: ServerVisionRequest, signal?: AbortSignal): Promise<VisionAnalyzeResponse>;
}
