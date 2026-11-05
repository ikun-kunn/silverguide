import {
  MAX_UPLOAD_BYTES,
  SUPPORTED_IMAGE_MEDIA_TYPES,
} from '@/services/ai/contract';
import type { SupportedImageMediaType } from '@/services/ai/contract';
import type { VisionErrorCode } from '@/types/vision';

export interface ImageCheckResult {
  ok: boolean;
  code: VisionErrorCode | null;
  message: string;
}

export interface ImageLike {
  type: string;
  size: number;
}

/** TRD §3.5 步骤 2 / §7.2：上传前的格式与大小检查（客户端第一道） */
export function checkImageFile(file: ImageLike): ImageCheckResult {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, code: 'INVALID_REQUEST', message: '这张图片是空的，请重新选择截图。' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, code: 'FILE_TOO_LARGE', message: '图片超过 5MB，请选择更小的截图。' };
  }
  if (!(SUPPORTED_IMAGE_MEDIA_TYPES as readonly string[]).includes(file.type)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: '只支持 PNG、JPEG、WebP、GIF 格式的图片。',
    };
  }
  return { ok: true, code: null, message: '图片检查通过。' };
}

/** TRD §3.5：必要压缩的触发阈值（M2 实现具体压缩算法） */
export const COMPRESS_THRESHOLD_BYTES = 1024 * 1024;

export function shouldCompress(file: ImageLike): boolean {
  return file.size > COMPRESS_THRESHOLD_BYTES;
}

export function extensionFor(mediaType: string): string {
  const mapping: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return mapping[mediaType] ?? 'bin';
}

export function isSupportedMediaType(value: string): value is SupportedImageMediaType {
  return (SUPPORTED_IMAGE_MEDIA_TYPES as readonly string[]).includes(value);
}
