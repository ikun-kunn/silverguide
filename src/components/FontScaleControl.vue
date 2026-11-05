<script setup lang="ts">
import { computed } from 'vue';
import { FONT_SCALE_OPTIONS, useSettingsStore } from '@/stores/settings';

const settings = useSettingsStore();
const activeLabel = computed(
  () => FONT_SCALE_OPTIONS.find((option) => option.value === settings.fontScale)?.label ?? '标准',
);
</script>

<template>
  <div>
    <p class="mb-2 font-semibold">文字大小（当前：{{ activeLabel }}）</p>
    <div class="flex flex-wrap gap-2" role="group" aria-label="文字大小">
      <button
        v-for="option in FONT_SCALE_OPTIONS"
        :key="option.value"
        type="button"
        class="min-h-tap min-w-[5rem] rounded-xl border-2 px-4 py-2 font-semibold"
        :class="
          settings.fontScale === option.value
            ? 'border-sg-primary bg-sg-primary text-sg-primary-ink'
            : 'border-sg-border bg-sg-surface text-sg-ink'
        "
        :aria-pressed="settings.fontScale === option.value"
        @click="settings.setFontScale(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>
