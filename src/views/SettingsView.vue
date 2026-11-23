<script setup lang="ts">
import FontScaleControl from '@/components/FontScaleControl.vue';
import HintLevelControl from '@/components/HintLevelControl.vue';
import ClearRecordsControl from '@/components/ClearRecordsControl.vue';
import { useSettingsStore } from '@/stores/settings';
import type { HintLevel } from '@/types';

const settings = useSettingsStore();

function setPreferredHint(level: HintLevel): void {
  settings.setPreferredHintLevel(level);
}
</script>

<template>
  <main class="mx-auto w-full max-w-[40rem] px-4 pb-12 pt-6">
    <header class="mb-6">
      <h1 class="text-[1.5rem] font-bold">设置</h1>
      <p class="mt-2 text-sg-muted">调整后会自动保存在当前浏览器中。</p>
    </header>

    <section class="mb-5 rounded-2xl border-2 border-sg-border bg-sg-surface p-4" aria-labelledby="display-title">
      <h2 id="display-title" class="mb-4 text-[1.15rem] font-semibold">显示</h2>
      <FontScaleControl />
      <div class="mt-4 flex items-center justify-between gap-3 border-t-2 border-sg-border pt-4">
        <div>
          <p class="font-semibold">高对比度</p>
          <p class="text-[0.85rem] text-sg-muted">加深文字和边框颜色</p>
        </div>
        <button
          type="button"
          role="switch"
          :aria-checked="settings.highContrast"
          class="min-h-tap min-w-[5.5rem] rounded-xl border-2 px-4 font-semibold"
          :class="settings.highContrast ? 'border-sg-primary bg-sg-primary text-sg-primary-ink' : 'border-sg-border'"
          @click="settings.setHighContrast(!settings.highContrast)"
        >
          {{ settings.highContrast ? '已开启' : '已关闭' }}
        </button>
      </div>
    </section>

    <section class="mb-5 rounded-2xl border-2 border-sg-border bg-sg-surface p-4" aria-labelledby="hint-title">
      <h2 id="hint-title" class="mb-2 text-[1.15rem] font-semibold">默认提示等级</h2>
      <p class="mb-3 text-[0.9rem] text-sg-muted">新任务从详细指导开始；再次练习会减少提示。训练中也可以随时调整。</p>
      <HintLevelControl
        :model-value="settings.preferredHintLevel"
        label="默认提示等级"
        @update:model-value="setPreferredHint"
      />
    </section>

    <section class="mb-5 rounded-2xl border-2 border-sg-border bg-sg-surface p-4" aria-labelledby="voice-title">
      <h2 id="voice-title" class="mb-2 text-[1.15rem] font-semibold">语音偏好</h2>
      <p class="mb-3 text-[0.9rem] text-sg-muted">支持中文语音播报；所有指导始终保留文字。</p>
      <button
        type="button"
        role="switch"
        :aria-checked="settings.voiceEnabled"
        class="min-h-tap w-full rounded-xl border-2 px-4 font-semibold"
        :class="settings.voiceEnabled ? 'border-sg-primary bg-sg-primary text-sg-primary-ink' : 'border-sg-border'"
        @click="settings.setVoiceEnabled(!settings.voiceEnabled)"
      >
        语音播报：{{ settings.voiceEnabled ? '已开启' : '已关闭' }}
      </button>
      <label for="voice-rate" class="mt-3 block font-semibold">朗读速度</label>
      <select id="voice-rate" :value="settings.voiceRate" class="min-h-tap w-full rounded-xl border-2 border-sg-border bg-sg-surface p-2" @change="settings.setVoiceRate(Number(($event.target as HTMLSelectElement).value))">
        <option :value="0.75">较慢</option><option :value="1">正常</option><option :value="1.25">较快</option>
      </select>
    </section>

    <section class="rounded-2xl border-2 border-sg-warn bg-sg-surface p-4" aria-labelledby="data-title">
      <h2 id="data-title" class="text-[1.15rem] font-semibold">本机数据</h2>
      <p class="my-2 text-sg-muted">清除练习进度和结果，不会清除上面的显示与声音偏好。</p>
      <ClearRecordsControl />
    </section>
  </main>
</template>
