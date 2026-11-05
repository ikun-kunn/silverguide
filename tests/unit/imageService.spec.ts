import { describe, expect, it } from 'vitest';
import {
  COMPRESS_THRESHOLD_BYTES,
  checkImageFile,
  extensionFor,
  isSupportedMediaType,
  shouldCompress,
} from '@/services/imageService';
import { MAX_UPLOAD_BYTES } from '@/services/ai/contract';

function image(type: string, size: number): { type: string; size: number } {
  return { type, size };
}

describe('上传前图片检查（TRD §3.5 / §7.2）', () => {
  it('接受 5MB 以内的常见格式', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(checkImageFile(image(type, 1024)).ok).toBe(true);
    }
    expect(checkImageFile(image('image/png', MAX_UPLOAD_BYTES)).ok).toBe(true);
  });

  it('拒绝空文件、超大文件与非法大小', () => {
    expect(checkImageFile(image('image/png', 0))).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(checkImageFile(image('image/png', Number.NaN))).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(checkImageFile(image('image/png', MAX_UPLOAD_BYTES + 1))).toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
  });

  it('拒绝不受支持的格式（含 SVG 脚本风险）', () => {
    for (const type of ['image/svg+xml', 'text/plain', 'application/pdf', '']) {
      expect(checkImageFile(image(type, 1024))).toMatchObject({
        code: 'UNSUPPORTED_MEDIA_TYPE',
      });
    }
  });

  it('压缩阈值与扩展名映射', () => {
    expect(shouldCompress(image('image/png', COMPRESS_THRESHOLD_BYTES))).toBe(false);
    expect(shouldCompress(image('image/png', COMPRESS_THRESHOLD_BYTES + 1))).toBe(true);
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/webp')).toBe('webp');
    expect(extensionFor('image/svg+xml')).toBe('bin');
    expect(isSupportedMediaType('image/png')).toBe(true);
    expect(isSupportedMediaType('image/svg+xml')).toBe(false);
  });
});
