import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsView from '@/views/SettingsView.vue';
import { useSettingsStore } from '@/stores/settings';
import { usePracticeStore } from '@/stores/practice';
import { progressRepository } from '@/repositories/progressRepository';

beforeEach(async () => {
  window.localStorage.clear();
  setActivePinia(createPinia());
  await progressRepository.clear();
});

describe('M1 设置页与适老化组件', () => {
  it('支持文字、高对比度、语音偏好和默认提示等级', async () => {
    const wrapper = mount(SettingsView);
    const settings = useSettingsStore();
    await wrapper.get('[data-testid="hint-level-2"]').trigger('click');
    expect(settings.preferredHintLevel).toBe(2);

    const switches = wrapper.findAll('button[role="switch"]');
    await switches[0]?.trigger('click');
    expect(settings.highContrast).toBe(true);
    expect(document.documentElement.dataset.highContrast).toBe('true');
    await switches[1]?.trigger('click');
    expect(settings.voiceEnabled).toBe(false);
    expect(wrapper.text()).toContain('中文语音播报');
    await wrapper.get('#voice-rate').setValue('0.75');
    expect(settings.voiceRate).toBe(0.75);
  });

  it('清除学习记录但保留适老化偏好', async () => {
    const settings = useSettingsStore();
    settings.setFontScale(1.35);
    const practice = usePracticeStore();
    await practice.loadTask('taxi-ride');
    expect(await progressRepository.list()).toHaveLength(1);

    const wrapper = mount(SettingsView);
    const clear = wrapper.findAll('button').find((button) => button.text() === '清除学习记录');
    await clear?.trigger('click');
    expect(await progressRepository.list()).toHaveLength(1);
    const cancel = wrapper.findAll('button').find((button) => button.text() === '取消，保留记录');
    await cancel?.trigger('click');
    expect(await progressRepository.list()).toHaveLength(1);
    await wrapper.findAll('button').find((button) => button.text() === '清除学习记录')?.trigger('click');
    await wrapper.get('[data-testid="confirm-clear-records"]').trigger('click');
    await flushPromises();
    expect(await progressRepository.list()).toEqual([]);
    expect(practice.snapshot).toBeNull();
    expect(settings.fontScale).toBe(1.35);
    expect(wrapper.text()).toContain('学习记录已清除');
  });

  it('清除失败时给出明确错误，不谎报成功', async () => {
    const clear = vi.spyOn(progressRepository, 'clear').mockRejectedValue(new Error('Blocked'));
    const wrapper = mount(SettingsView);
    const button = wrapper.findAll('button').find((item) => item.text() === '清除学习记录');
    await button?.trigger('click');
    await wrapper.get('[data-testid="confirm-clear-records"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('清除失败');
    expect(wrapper.text()).not.toContain('显示与声音偏好保持不变');
    clear.mockRestore();
  });
});
