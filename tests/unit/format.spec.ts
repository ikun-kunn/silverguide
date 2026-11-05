import { describe, expect, it } from 'vitest';
import { formatDateTime, formatDuration } from '@/utils/format';

describe('学习档案时间格式化', () => {
  it('秒、分、小时采用清楚的中文单位', () => {
    expect(formatDuration('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:42.000Z')).toBe('42 秒');
    expect(formatDuration('2026-01-01T00:00:00.000Z', '2026-01-01T00:02:05.000Z')).toBe('2 分 5 秒');
    expect(formatDuration('2026-01-01T00:00:00.000Z', '2026-01-01T01:02:00.000Z')).toBe('1 小时 2 分');
  });

  it('未完成、无效日期与倒序时间不会生成误导性用时', () => {
    expect(formatDuration('2026-01-01T00:00:00.000Z', null)).toBe('尚未完成');
    expect(formatDuration('bad', '2026-01-01T00:00:00.000Z')).toBe('用时未知');
    expect(formatDuration('2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe('用时未知');
    expect(formatDateTime('bad')).toBe('时间未知');
  });
});
