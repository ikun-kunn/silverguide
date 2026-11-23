import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores/settings';
import { DEFAULT_USER_SETTINGS } from '@/types/settings';

beforeEach(() => {
  window.localStorage.clear();
  setActivePinia(createPinia());
});

describe('本地设置持久化（TRD §6.4 / NFR-006）', () => {
  it('默认值符合「基础 18px + L1 提示」基线', () => {
    const store = useSettingsStore();
    expect(store.fontScale).toBe(1);
    expect(store.preferredHintLevel).toBe(1);
    expect(store.voiceEnabled).toBe(true);
    expect(store.highContrast).toBe(false);
  });

  it('刷新后可从本地存储恢复设置', () => {
    window.localStorage.setItem(
      'silverguide.settings.m0',
      JSON.stringify({ ...DEFAULT_USER_SETTINGS, fontScale: 1.35, voiceEnabled: false }),
    );
    setActivePinia(createPinia());
    const restored = useSettingsStore();
    expect(restored.fontScale).toBe(1.35);
    expect(restored.voiceEnabled).toBe(false);
  });

  it('损坏或越界的本地数据回退到安全默认值', () => {
    window.localStorage.setItem('silverguide.settings.m0', '{not-json');
    setActivePinia(createPinia());
    expect(useSettingsStore().fontScale).toBe(1);

    window.localStorage.setItem(
      'silverguide.settings.m0',
      JSON.stringify({ fontScale: 99, preferredHintLevel: 42 }),
    );
    setActivePinia(createPinia());
    const store = useSettingsStore();
    expect(store.fontScale).toBeLessThanOrEqual(1.6);
    expect(store.preferredHintLevel).toBe(3);
  });
  it('非有限数值回到默认提示档位；日志不包含本地原始数据', () => {
    window.localStorage.setItem('silverguide.settings.m0', '{"preferredHintLevel":1e309}');
    setActivePinia(createPinia());
    expect(useSettingsStore().preferredHintLevel).toBe(DEFAULT_USER_SETTINGS.preferredHintLevel);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('private-user-value', 'SecurityError'); });
    setActivePinia(createPinia());
    expect(useSettingsStore().fontScale).toBe(1);
    expect(warn).toHaveBeenCalledWith('[SilverGuide]', 'settings.read', { errorType: 'SecurityError' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-user-value');
    getItem.mockRestore(); warn.mockRestore();
  });
});
