import type { BoundingBox } from '@/types/vision';

export interface SvgRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** TRD §3.6 / §7.2：坐标统一使用 0~1 归一化比例 */
export function isNormalized(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

/** 严格校验：长度为 4、全为有限数字、均在 [0,1]、且 x1<x2、y1<y2 */
export function isNormalizedBoundingBox(value: unknown): value is BoundingBox {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const values = value as unknown[];
  if (!values.every((item): item is number => typeof item === 'number')) return false;
  const [x1, y1, x2, y2] = values as [number, number, number, number];
  if (!isNormalized(x1) || !isNormalized(y1) || !isNormalized(x2) || !isNormalized(y2)) {
    return false;
  }
  return x1 < x2 && y1 < y2;
}

/** 将越界数值裁剪到 [0,1]；无法构成有效矩形时返回 null（绝不返回越界坐标） */
export function sanitizeBoundingBox(value: unknown): BoundingBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const values = value as unknown[];
  if (!values.every((item) => typeof item === 'number' && Number.isFinite(item))) return null;
  const clamp = (n: number): number => Math.min(1, Math.max(0, n));
  const [x1, y1, x2, y2] = (values as number[]).map(clamp);
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
  if (x1 >= x2 || y1 >= y2) return null;
  return [x1, y1, x2, y2];
}

/** SVG Overlay 使用 viewBox="0 0 1 1" 时直接绘制，标注会随图片等比缩放 */
export function toNormalizedRect(box: BoundingBox): SvgRect {
  return { x: box[0], y: box[1], width: box[2] - box[0], height: box[3] - box[1] };
}

/** 以原图像素绘制时同样保证不超出边界 */
export function toPixelRect(box: BoundingBox, width: number, height: number): SvgRect {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 0;
  const clamp = (n: number): number => Math.min(1, Math.max(0, n));
  const x1 = clamp(box[0]) * safeWidth;
  const y1 = clamp(box[1]) * safeHeight;
  const x2 = clamp(box[2]) * safeWidth;
  const y2 = clamp(box[3]) * safeHeight;
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}
