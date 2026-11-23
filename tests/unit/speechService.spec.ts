import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { nextTick } from 'vue';
import SpeechControls from '@/components/SpeechControls.vue';
import { canSpeak, getSpeechAvailability, observeSpeechAvailability, MAX_SPEECH_SEGMENT_CHARS, speakChinese, splitSpeechSegments, stopSpeech } from '@/services/speechService';

afterEach(() => {
  stopSpeech();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface FakeSynthesis {
  cancel: ReturnType<typeof vi.fn>;
  speak: ReturnType<typeof vi.fn>;
  getVoices: ReturnType<typeof vi.fn>;
  listeners: Record<string, Array<() => void>>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function installSynthesis(voices: Array<{ lang: string }> = []): FakeSynthesis {
  const listeners: Record<string, Array<() => void>> = {};
  const synthesis: FakeSynthesis = {
    cancel: vi.fn(),
    speak: vi.fn(),
    getVoices: vi.fn(() => voices),
    listeners,
    addEventListener: vi.fn((type: string, callback: () => void) => {
      (listeners[type] ??= []).push(callback);
    }),
    removeEventListener: vi.fn((type: string, callback: () => void) => {
      listeners[type] = (listeners[type] ?? []).filter(item => item !== callback);
    }),
  };
  class Utterance {
    lang = '';
    rate = 1;
    voice: { lang: string } | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  vi.stubGlobal('speechSynthesis', synthesis);
  return synthesis;
}

describe('M2 中文语音服务', () => {
  it('使用中文语音、设置速度，并停止上一条语音', () => {
    const synthesis = installSynthesis([{ lang: 'zh-CN' }]);
    expect(canSpeak()).toBe(true);
    expect(speakChinese('点击预约挂号', 0.75)).toBe(true);
    expect(synthesis.cancel).toHaveBeenCalledOnce();
    expect(synthesis.speak).toHaveBeenCalledWith(expect.objectContaining({
      text: '点击预约挂号', lang: 'zh-CN', rate: 0.75, voice: { lang: 'zh-CN' },
    }));
    stopSpeech();
    expect(synthesis.cancel).toHaveBeenCalledTimes(2);
  });

  it('浏览器不支持时仍可安全降级', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    expect(canSpeak()).toBe(false);
    expect(speakChinese('请重试')).toBe(false);
    expect(() => stopSpeech()).not.toThrow();
  });

  it('按上限切分文本，短句合并为一段', () => {
    expect(splitSpeechSegments('  ')).toEqual([]);
    expect(splitSpeechSegments('短句一短句二')).toEqual(['短句一短句二']);
    const long = splitSpeechSegments('一'.repeat(MAX_SPEECH_SEGMENT_CHARS * 2 + 5));
    expect(long).toHaveLength(3);
    expect(long.every((segment) => segment.length <= MAX_SPEECH_SEGMENT_CHARS)).toBe(true);
    expect(long.join('')).toBe('一'.repeat(MAX_SPEECH_SEGMENT_CHARS * 2 + 5));
    expect(splitSpeechSegments('中文', 0.5)).toEqual(['中', '文']);
  });

  it('长文本逐段排队朗读，全部结束后才触发 onEnd', () => {
    const synthesis = installSynthesis([{ lang: 'zh-Hans' }]);
    const onEnd = vi.fn();
    const text = '一'.repeat(MAX_SPEECH_SEGMENT_CHARS * 2);
    expect(speakChinese(text, 1, { onEnd })).toBe(true);
    expect(synthesis.speak).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();

    const first = synthesis.speak.mock.calls[0]?.[0] as { onend: () => void; text: string };
    expect(first.text).toHaveLength(MAX_SPEECH_SEGMENT_CHARS);
    first.onend();
    expect(synthesis.speak).toHaveBeenCalledTimes(2);
    const second = synthesis.speak.mock.calls[1]?.[0] as { onend: () => void };
    second.onend();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('新播报取消旧队列，旧 onend 不会继续推进', () => {
    const synthesis = installSynthesis([{ lang: 'zh-CN' }]);
    const firstEnd = vi.fn();
    speakChinese('一'.repeat(MAX_SPEECH_SEGMENT_CHARS * 2), 1, { onEnd: firstEnd });
    const first = synthesis.speak.mock.calls[0]?.[0] as { onend: () => void };
    speakChinese('新内容。');
    first.onend();
    expect(synthesis.speak).toHaveBeenCalledTimes(2);
    expect(firstEnd).not.toHaveBeenCalled();
  });

  it('音色异步就绪前只降级为文字，voiceschanged 后使用中文音色并释放监听', () => {
    const synthesis = installSynthesis([]);
    const observed = vi.fn(); const unsubscribe = observeSpeechAvailability(observed);
    expect(getSpeechAvailability()).toBe('no-chinese');
    expect(observed).toHaveBeenLastCalledWith('no-chinese');
    expect(speakChinese('第一句。')).toBe(false);
    expect(synthesis.speak).not.toHaveBeenCalled();

    synthesis.getVoices.mockReturnValue([{ lang: 'zh-CN' }]);
    for (const callback of synthesis.listeners['voiceschanged'] ?? []) callback();
    expect(observed).toHaveBeenLastCalledWith('ready');
    expect(speakChinese('第二句。')).toBe(true);
    expect((synthesis.speak.mock.calls[0]?.[0] as { voice: unknown }).voice).toEqual({ lang: 'zh-CN' });
    unsubscribe();
    expect(synthesis.listeners['voiceschanged']).toHaveLength(0);
  });

  it('只有非中文音色时页面显示文字降级，中文资源加载后自动显示朗读入口', async () => {
    const synthesis = installSynthesis([{ lang: 'en-US' }]);
    const wrapper = mount(SpeechControls, { props: { text: '点击进入首页' }, global: { plugins: [createPinia()] } });
    expect(wrapper.text()).toContain('暂未检测到中文语音');
    expect(wrapper.findAll('button')).toHaveLength(0);
    expect(speakChinese('中文说明')).toBe(false);
    synthesis.getVoices.mockReturnValue([{ lang: 'zh-CN' }]);
    for (const callback of synthesis.listeners['voiceschanged'] ?? []) callback();
    await nextTick();
    expect(wrapper.text()).toContain('朗读说明');
    await wrapper.findAll('button').find(button => button.text() === '朗读说明')?.trigger('click');
    expect(synthesis.speak).toHaveBeenCalledOnce();
    wrapper.unmount();
    expect(synthesis.listeners['voiceschanged']).toHaveLength(0);
  });

  it('朗读异常时触发 onError 且不继续队列', () => {
    const synthesis = installSynthesis([{ lang: 'zh-CN' }]);
    const onError = vi.fn();
    speakChinese('第一段。第二段。', 1, { onError });
    const first = synthesis.speak.mock.calls[0]?.[0] as { onerror: () => void };
    first.onerror();
    expect(onError).toHaveBeenCalledOnce();
    expect(synthesis.speak).toHaveBeenCalledTimes(1);
  });

  it('浏览器未发出结束或错误事件时，watchdog 停止队列并回退文字', () => {
    vi.useFakeTimers();
    const synthesis = installSynthesis([{ lang: 'zh-CN' }]);
    const onError = vi.fn(); const onEnd = vi.fn();
    speakChinese('短句。', 1, { onError, onEnd });
    vi.advanceTimersByTime(20_000);
    expect(onError).toHaveBeenCalledOnce();
    expect(onEnd).not.toHaveBeenCalled();
    expect(synthesis.cancel).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
