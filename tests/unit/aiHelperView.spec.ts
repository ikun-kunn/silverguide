import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AiHelperView from '@/views/AiHelperView.vue';
import { analyzeScreenshot } from '@/services/ai/visionClient';
import { prepareScreenshot } from '@/services/imageService';
import type { VisionAnalysisOutcome } from '@/types/vision';

vi.mock('@/services/ai/visionClient', () => ({ analyzeScreenshot: vi.fn() }));
vi.mock('@/services/imageService', async (importOriginal) => ({ ...await importOriginal<typeof import('@/services/imageService')>(), prepareScreenshot: vi.fn() }));

const success: VisionAnalysisOutcome = { analysis: { id: 'test', pageSummary: '医院服务首页', instruction: '点击预约挂号', targetLabel: '预约挂号', boundingBox: [0.1, 0.2, 0.5, 0.6], confidence: 0.9, safetyWarning: null, status: 'success' }, errorCode: null, degraded: false };

function setup() {
  return mount(AiHelperView, { global: { plugins: [createPinia()], stubs: { RouterLink: { template: '<a><slot /></a>' } } } });
}
async function choose(wrapper: ReturnType<typeof setup>, file = new File(['image'], 'shot.png', { type: 'image/png' })) {
  const input = wrapper.get('[data-testid="screenshot-input"]');
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
  await input.trigger('change');
  await flushPromises();
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prepareScreenshot).mockImplementation(async file => file);
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

describe('M2 截图指导页面', () => {
  it('未选图片或未同意传输时禁止分析，确认后显示可信结果及可关闭标注', async () => {
    vi.mocked(analyzeScreenshot).mockResolvedValue(success);
    const wrapper = setup();
    expect(wrapper.get('[data-testid="analyze"]').attributes('disabled')).toBeDefined();
    await choose(wrapper);
    expect(wrapper.get('img').attributes('src')).toBe('blob:preview');
    expect(wrapper.get('[data-testid="analyze"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-testid="privacy-consent"]').setValue(true);
    await wrapper.get('#question').setValue('怎么挂号？');
    await wrapper.get('[data-testid="analyze"]').trigger('click');
    await flushPromises();
    expect(analyzeScreenshot).toHaveBeenCalledWith(expect.objectContaining({ question: '怎么挂号？' }), expect.anything());
    expect(wrapper.get('[data-testid="ai-result"]').text()).toContain('点击预约挂号');
    expect(wrapper.find('[data-testid="annotation"]').exists()).toBe(true);
    await wrapper.findAll('button').find((button) => button.text() === '隐藏标注')?.trigger('click');
    expect(wrapper.find('[data-testid="annotation"]').exists()).toBe(false);
    wrapper.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('不确定、服务不可用或涉及敏感业务均不画标注', async () => {
    const wrapper = setup();
    await choose(wrapper);
    await wrapper.get('[data-testid="privacy-consent"]').setValue(true);
    vi.mocked(analyzeScreenshot).mockResolvedValueOnce({ ...success, analysis: { ...success.analysis, status: 'uncertain', boundingBox: null } });
    await wrapper.get('[data-testid="analyze"]').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('不能可靠确认');
    expect(wrapper.find('[data-testid="annotation"]').exists()).toBe(false);
    vi.mocked(analyzeScreenshot).mockResolvedValueOnce({ ...success, analysis: { ...success.analysis, safetyWarning: '请谨慎付款' } });
    await wrapper.get('[data-testid="analyze"]').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('安全提醒');
    expect(wrapper.get('[data-testid="ai-result"]').text()).not.toContain('点击预约挂号');
    expect(wrapper.get('[data-testid="ai-result"]').text()).toContain('请暂停操作');
    expect(wrapper.find('[data-testid="annotation"]').exists()).toBe(false);
    vi.mocked(analyzeScreenshot).mockResolvedValueOnce({ ...success, analysis: { ...success.analysis, pageSummary: '', instruction: 'AI 看图服务尚未接入', status: 'failed', boundingBox: null, confidence: null, targetLabel: null }, degraded: true, errorCode: 'NOT_CONFIGURED' });
    await wrapper.get('[data-testid="analyze"]').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('分析未完成');
    expect(wrapper.text()).toContain('返回模拟训练');
    expect(wrapper.find('[data-testid="annotation"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('取消等待后不接受迟到结果，允许重试', async () => {
    let finish!: (value: VisionAnalysisOutcome) => void;
    vi.mocked(analyzeScreenshot).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const wrapper = setup(); await choose(wrapper);
    await wrapper.get('[data-testid="privacy-consent"]').setValue(true);
    await wrapper.get('[data-testid="analyze"]').trigger('click');
    expect(wrapper.text()).toContain('正在分析');
    await wrapper.findAll('button').find((button) => button.text() === '取消等待')?.trigger('click');
    finish(success); await flushPromises();
    expect(wrapper.find('[data-testid="ai-result"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="analyze"]').attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('错误图片格式不会发出 AI 请求', async () => {
    const wrapper = setup();
    await choose(wrapper, new File(['bad'], 'bad.svg', { type: 'image/svg+xml' }));
    expect(wrapper.text()).toContain('只支持');
    expect(wrapper.get('[data-testid="analyze"]').attributes('disabled')).toBeDefined();
    expect(analyzeScreenshot).not.toHaveBeenCalled();
  });
  it('图片处理异常只显示固定提示，错误详情既不进入页面也不进入日志', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(prepareScreenshot).mockRejectedValueOnce(new DOMException('private-file-location', 'DataError'));
    const wrapper = setup(); await choose(wrapper);
    expect(wrapper.text()).toContain('图片读取或处理失败，请重新选择清晰的截图');
    expect(wrapper.text()).not.toContain('private-file-location');
    expect(warn).toHaveBeenCalledWith('[SilverGuide]', 'vision.prepareImage', { errorType: 'DataError' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-file-location');
    expect(wrapper.get('[data-testid="analyze"]').attributes('disabled')).toBeDefined();
    expect(analyzeScreenshot).not.toHaveBeenCalled();
    wrapper.unmount(); warn.mockRestore();
  });
  it('无法创建预览时不保留可上传的图片', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(URL.createObjectURL).mockImplementationOnce(() => { throw new Error('preview failed'); });
    const wrapper = setup(); await choose(wrapper);
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[data-testid="analyze"]').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });
});
