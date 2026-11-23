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

/** 图片仅在内存中解码、缩放；不写入本地存储。保留原始比例，避免坐标偏移。 */
export async function prepareScreenshot(file: File): Promise<Blob> {
  const check = checkImageFile(file);
  if (!check.ok) throw new Error(check.message);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('无法读取这张图片，请换一张截图。'));
      image.src = url;
    });
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) throw new Error('无法读取这张图片，请换一张截图。');
    const scale = Math.min(1, 1800 / Math.max(width, height));
    // 即便原图已很小，也从解码后的像素重新编码，不直接传输原文件及其元数据。
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法处理图片，请换一张较小的截图。');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
    if (!blob || !checkImageFile(blob).ok) throw new Error('图片处理后仍然太大，请换一张较小的截图。');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
