import { describe, expect, it } from 'vitest';
import {
  INVALID_OUTPUT_MESSAGE,
  MIN_CONFIDENCE_FOR_BOX,
  parseVisionResponse,
  validateVisionResponse,
} from '@/services/aiResponseValidator';

function validResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    success: true,
    pageSummary: '这是医院服务首页，可以预约挂号。',
    instruction: '请点击页面中间的「预约挂号」按钮。',
    targetLabel: '预约挂号',
    boundingBox: [0.1, 0.2, 0.6, 0.32],
    confidence: 0.86,
    safetyWarning: null,
    errorCode: null,
    ...overrides,
  };
}

describe('AI 响应结构与坐标校验（TRD §10.1 / §7.2 / §7.3）', () => {
  it('合法响应映射为 ScreenshotAnalysis，保留全部 §6.5 字段', () => {
    const result = validateVisionResponse(validResponse());
    expect(result.ok).toBe(true);
    expect(result.errorCode).toBeNull();
    expect(result.analysis.status).toBe('success');
    expect(result.analysis.boundingBox).toEqual([0.1, 0.2, 0.6, 0.32]);
    expect(result.analysis.confidence).toBe(0.86);
    expect(result.analysis.pageSummary).toContain('医院服务首页');
    expect(result.analysis.targetLabel).toBe('预约挂号');
    expect(result.analysis.id).toMatch(/^analysis_/);
  });

  it('置信度缺失时降级为 uncertain 并隐藏坐标', () => {
    const result = validateVisionResponse(validResponse({ confidence: null }));
    expect(result.ok).toBe(true);
    expect(result.analysis.status).toBe('uncertain');
    expect(result.analysis.boundingBox).toBeNull();
    expect(result.analysis.instruction).toContain('预约挂号');
  });

  it('置信度低于阈值时隐藏坐标，等于阈值时保留', () => {
    const low = validateVisionResponse(
      validResponse({ confidence: MIN_CONFIDENCE_FOR_BOX - 0.01 }),
    );
    expect(low.analysis.status).toBe('uncertain');
    expect(low.analysis.boundingBox).toBeNull();

    const boundary = validateVisionResponse(
      validResponse({ confidence: MIN_CONFIDENCE_FOR_BOX }),
    );
    expect(boundary.analysis.status).toBe('success');
    expect(boundary.analysis.boundingBox).toEqual([0.1, 0.2, 0.6, 0.32]);
  });

  it.each([
    ['坐标超出右边界', [0.1, 0.2, 1.2, 0.32]],
    ['坐标出现负数', [-0.1, 0.2, 0.6, 0.32]],
    ['矩形方向反转', [0.6, 0.2, 0.1, 0.32]],
    ['零面积矩形', [0.1, 0.2, 0.1, 0.32]],
    ['长度不正确', [0.1, 0.2, 0.6]],
    ['包含非数字', [0.1, '0.2', 0.6, 0.32]],
    ['包含 NaN', [0.1, 0.2, 0.6, Number.NaN]],
  ])('%s：不展示越界标注，仅保留文字指导', (_name, box) => {
    const result = validateVisionResponse(validResponse({ boundingBox: box }));
    expect(result.ok).toBe(true);
    expect(result.analysis.status).toBe('uncertain');
    expect(result.analysis.boundingBox).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.analysis.instruction).toContain('预约挂号');
  });

  it('没有坐标时仍可给出纯文字指导', () => {
    const result = validateVisionResponse(validResponse({ boundingBox: null }));
    expect(result.analysis.status).toBe('success');
    expect(result.analysis.boundingBox).toBeNull();
  });

  it('success=false 时返回 failed，并沿用服务端 errorCode', () => {
    const result = validateVisionResponse(
      validResponse({ success: false, errorCode: 'AI_TIMEOUT' }),
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('AI_TIMEOUT');
    expect(result.analysis.status).toBe('failed');
    expect(result.analysis.boundingBox).toBeNull();
    expect(result.analysis.instruction).toBe(INVALID_OUTPUT_MESSAGE);
  });

  it('success=false 且缺少 errorCode 时回退为 AI_UNAVAILABLE', () => {
    const result = validateVisionResponse(validResponse({ success: false, errorCode: null }));
    expect(result.errorCode).toBe('AI_UNAVAILABLE');
  });

  it.each([
    ['缺少 success', { success: undefined }],
    ['success 类型错误', { success: 'true' }],
    ['缺少 pageSummary', { pageSummary: '' }],
    ['缺少 instruction', { instruction: undefined }],
    ['confidence 越界', { confidence: 1.4 }],
    ['confidence 类型错误', { confidence: 'high' }],
    ['targetLabel 类型错误', { targetLabel: 42 }],
    ['文本超长', { pageSummary: 'x'.repeat(1001) }],
  ])('%s：判定为无效模型输出', (_name, override) => {
    const payload = validResponse(override);
    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) delete payload[key];
    }
    const result = validateVisionResponse(payload);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('INVALID_MODEL_OUTPUT');
    expect(result.analysis.status).toBe('failed');
    expect(result.analysis.boundingBox).toBeNull();
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it.each([null, [], 'text', 42])('非对象响应 %s 一律拒绝', (value) => {
    const result = validateVisionResponse(value);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('INVALID_MODEL_OUTPUT');
  });

  it('非法 JSON 文本不会被当作可信指引', () => {
    const result = parseVisionResponse('这不是 JSON');
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('INVALID_MODEL_OUTPUT');
  });

  it('合法 JSON 文本可解析并保留安全提醒', () => {
    const result = parseVisionResponse(
      JSON.stringify(validResponse({ safetyWarning: '请不要在此页面输入银行卡密码。' })),
    );
    expect(result.ok).toBe(true);
    expect(result.analysis.safetyWarning).toContain('银行卡密码');
  });

  it('永不输出超出 [0,1] 的坐标（批量恶意输入）', () => {
    const candidates: unknown[] = [
      [0, 0, 2, 2],
      [-1, -1, 0.5, 0.5],
      [0.9, 0.9, 0.1, 0.1],
      [Infinity, 0, 1, 1],
      [0, 0, 1, 1, 1],
    ];
    for (const box of candidates) {
      const result = validateVisionResponse(validResponse({ boundingBox: box }));
      const output = result.analysis.boundingBox;
      if (output !== null) {
        expect(output.every((v) => v >= 0 && v <= 1)).toBe(true);
      }
      expect(result.analysis.status).not.toBe('failed');
    }
  });
});
