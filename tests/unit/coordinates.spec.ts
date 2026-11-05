import { describe, expect, it } from 'vitest';
import {
  isNormalized,
  isNormalizedBoundingBox,
  sanitizeBoundingBox,
  toNormalizedRect,
  toPixelRect,
} from '@/utils/coordinates';
import type { BoundingBox } from '@/types/vision';

describe('归一化坐标（TRD §3.6 / §7.2）', () => {
  it('接受 0 与 1 两个边界值', () => {
    expect(isNormalized(0)).toBe(true);
    expect(isNormalized(1)).toBe(true);
    expect(isNormalized(0.5)).toBe(true);
  });

  it('拒绝非有限数与越界值', () => {
    expect(isNormalized(Number.NaN)).toBe(false);
    expect(isNormalized(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isNormalized(-0.01)).toBe(false);
    expect(isNormalized(1.01)).toBe(false);
  });

  it('接受合法的 [x1, y1, x2, y2]', () => {
    expect(isNormalizedBoundingBox([0.1, 0.2, 0.6, 0.45])).toBe(true);
    expect(isNormalizedBoundingBox([0, 0, 1, 1])).toBe(true);
  });

  it('拒绝长度错误、含非数字、反向及零面积矩形', () => {
    expect(isNormalizedBoundingBox([0.1, 0.2, 0.6])).toBe(false);
    expect(isNormalizedBoundingBox([0.1, 0.2, 0.6, 0.45, 0.9])).toBe(false);
    expect(isNormalizedBoundingBox([0.1, '0.2', 0.6, 0.45])).toBe(false);
    expect(isNormalizedBoundingBox([0.6, 0.2, 0.1, 0.45])).toBe(false);
    expect(isNormalizedBoundingBox([0.1, 0.2, 0.1, 0.45])).toBe(false);
    expect(isNormalizedBoundingBox(null)).toBe(false);
    expect(isNormalizedBoundingBox('0.1,0.2,0.6,0.45')).toBe(false);
  });

  it('拒绝超出图片边界的坐标', () => {
    expect(isNormalizedBoundingBox([-0.1, 0.2, 0.6, 0.45])).toBe(false);
    expect(isNormalizedBoundingBox([0.1, 0.2, 1.2, 0.45])).toBe(false);
    expect(isNormalizedBoundingBox([0.1, 0.2, 0.6, Number.NaN])).toBe(false);
  });

  it('sanitizeBoundingBox 裁剪越界值且结果始终落在 [0,1]', () => {
    const result = sanitizeBoundingBox([-0.2, 0.2, 1.4, 0.9]);
    expect(result).toEqual([0, 0.2, 1, 0.9]);
    expect(result?.every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it('sanitizeBoundingBox 对退化矩形返回 null，绝不返回越界坐标', () => {
    expect(sanitizeBoundingBox([0.8, 0.2, 0.2, 0.9])).toBeNull();
    expect(sanitizeBoundingBox([0.1, 0.2, 0.6])).toBeNull();
    expect(sanitizeBoundingBox([NaN, 0.2, 0.6, 0.9])).toBeNull();
  });

  it('SVG 归一化矩形随 viewBox 等比缩放且不越界', () => {
    const box: BoundingBox = [0.1, 0.2, 0.6, 0.45];
    expect(toNormalizedRect(box)).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.25 });
    const rect = toNormalizedRect(box);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1);
    expect(rect.y + rect.height).toBeLessThanOrEqual(1);
  });

  it('像素矩形不超出给定图片宽高', () => {
    const box: BoundingBox = [0, 0, 1, 1];
    expect(toPixelRect(box, 320, 160)).toEqual({ x: 0, y: 0, width: 320, height: 160 });
    expect(toPixelRect(box, -1, 100)).toEqual({ x: 0, y: 0, width: 0, height: 100 });
  });
});
