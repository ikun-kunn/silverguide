import { defineStore } from 'pinia';
import { DEFAULT_USER_SETTINGS } from '@/types/settings';
import type { UserSettings } from '@/types/settings';

const STORAGE_KEY = 'silverguide.settings.m0';

/** TRD §4.2：基础 18px，允许继续放大 */
export const FONT_SCALE_OPTIONS = [
  { label: '标准', value: 1 },
  { label: '大', value: 1.15 },
  { label: '特大', value: 1.35 },
] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * M0 仅验证状态管理与适老化布局，设置用 localStorage 轻量持久化。
 * 学习进度（PracticeSession）按 §5.1 使用 IndexedDB + Dexie，属于 M1 范围。
 */
function readStored(): UserSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const value = parsed as Partial<UserSettings>;
    return {
      fontScale:
        typeof value.fontScale === 'number' && Number.isFinite(value.fontScale)
          ? clamp(value.fontScale, 1, 1.6)
          : DEFAULT_USER_SETTINGS.fontScale,
      voiceEnabled:
        typeof value.voiceEnabled === 'boolean'
          ? value.voiceEnabled
          : DEFAULT_USER_SETTINGS.voiceEnabled,
      voiceRate:
        typeof value.voiceRate === 'number' && Number.isFinite(value.voiceRate)
          ? clamp(value.voiceRate, 0.5, 2)
          : DEFAULT_USER_SETTINGS.voiceRate,
      highContrast:
        typeof value.highContrast === 'boolean'
          ? value.highContrast
          : DEFAULT_USER_SETTINGS.highContrast,
      preferredHintLevel:
        typeof value.preferredHintLevel === 'number'
          ? clamp(Math.round(value.preferredHintLevel), 1, 3)
          : DEFAULT_USER_SETTINGS.preferredHintLevel,
    };
  } catch {
    return null;
  }
}

export const useSettingsStore = defineStore('settings', {
  state: (): UserSettings => ({ ...(readStored() ?? DEFAULT_USER_SETTINGS) }),

  actions: {
    setFontScale(value: number): void {
      this.fontScale = Number.isFinite(value) ? clamp(value, 1, 1.6) : DEFAULT_USER_SETTINGS.fontScale;
      this.applyToDocument();
      this.persist();
    },
    setVoiceEnabled(value: boolean): void {
      this.voiceEnabled = value;
      this.persist();
    },
    setHighContrast(value: boolean): void {
      this.highContrast = value;
      this.applyToDocument();
      this.persist();
    },
    setPreferredHintLevel(value: number): void {
      this.preferredHintLevel = Number.isFinite(value)
        ? clamp(Math.round(value), 1, 3)
        : DEFAULT_USER_SETTINGS.preferredHintLevel;
      this.persist();
    },
    applyToDocument(): void {
      if (typeof document === 'undefined') return;
      const root = document.documentElement;
      root.style.setProperty('--sg-font-scale', String(this.fontScale));
      root.dataset.highContrast = String(this.highContrast);
    },
    persist(): void {
      if (typeof window === 'undefined') return;
      const snapshot: UserSettings = {
        fontScale: this.fontScale,
        voiceEnabled: this.voiceEnabled,
        voiceRate: this.voiceRate,
        highContrast: this.highContrast,
        preferredHintLevel: this.preferredHintLevel,
      };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        // 隐私模式或配额不足时静默降级为内存态，不影响使用
      }
    },
  },
});
