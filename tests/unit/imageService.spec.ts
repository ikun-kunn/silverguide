import { describe, expect, it, vi } from 'vitest';
import {
  COMPRESS_THRESHOLD_BYTES,
  checkImageFile,
  extensionFor,
  isSupportedMediaType,
  prepareScreenshot,
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

  it('小图片也重新编码为新 Blob，不直接返回原始文件', async () => {
    const drawImage = vi.fn();
    const encoded = new Blob(['pixel-only'], { type: 'image/webp' });
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:temporary'), revokeObjectURL: revoke });
    vi.stubGlobal('Image', class {
      naturalWidth = 320; naturalHeight = 640;
      onload: (() => void) | null = null;
      set src(_src: string) { this.onload?.(); }
    });
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(encoded));
    try {
      const original = new File(['image-with-metadata'], 'private-name.jpg', { type: 'image/jpeg' });
      const result = await prepareScreenshot(original);
      expect(result).toBe(encoded);
      expect(result).not.toBe(original);
      expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 320, 640);
      expect(revoke).toHaveBeenCalledWith('blob:temporary');
    } finally { context.mockRestore(); toBlob.mockRestore(); vi.unstubAllGlobals(); }
  });
});
