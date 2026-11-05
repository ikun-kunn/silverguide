<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import AppButton from '@/components/AppButton.vue';
import FontScaleControl from '@/components/FontScaleControl.vue';
import { useSettingsStore } from '@/stores/settings';

const router = useRouter();
const settings = useSettingsStore();
const notice = ref('');
const ONBOARDING_KEY = 'silverguide.onboarding.seen.m1';

function hasSeenGuide(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_KEY) === '1';
  } catch {
    return false;
  }
}

const showGuide = ref(!hasSeenGuide());

function dismissGuide(): void {
  showGuide.value = false;
  try {
    window.localStorage.setItem(ONBOARDING_KEY, '1');
  } catch {
    // 隐私模式下仍可在当前页面关闭说明，不影响训练入口
  }
}

function startLearning(): void {
  void router.push('/practice');
}

function openAiHelper(): void {
  notice.value = 'AI 服务暂不可用，将在下一阶段开放。模拟训练不需要 AI、联网或登录，现在就可以正常完成。';
}
</script>

<template>
  <main class="mx-auto w-full max-w-[40rem] px-4 pb-12 pt-6">
    <section aria-labelledby="welcome-title" class="mb-7">
      <p class="mb-1 font-semibold text-sg-primary">SilverGuide 银龄引路人</p>
      <h1 id="welcome-title" class="text-[1.65rem] font-bold leading-tight">一步一步，学会用手机</h1>
      <p class="mt-3 text-sg-muted">
        在安全的模拟页面里练习医院挂号和手机打车。按自己的节奏操作，做错了可以重试，不会真的下单。
      </p>
      <p
        class="mt-4 inline-block rounded-xl border-2 border-sg-border bg-sg-surface px-3 py-2 font-semibold text-sg-warn"
        data-testid="demo-badge"
      >
        模拟练习，不产生真实订单
      </p>
    </section>

    <section
      v-if="showGuide"
      aria-labelledby="guide-title"
      class="mb-6 rounded-2xl border-2 border-sg-primary bg-sg-surface p-4"
      data-testid="first-visit-guide"
    >
      <h2 id="guide-title" class="text-[1.1rem] font-semibold">第一次使用？</h2>
      <p class="my-2 text-sg-muted">点「开始学习」，选一项练习，照着提示一步一步操作。做错了可以重试，这里不会真的下单。</p>
      <button
        type="button"
        class="min-h-tap rounded-xl border-2 border-sg-primary bg-sg-primary px-4 font-semibold text-sg-primary-ink"
        @click="dismissGuide"
      >
        知道了，跳过说明
      </button>
    </section>

    <section aria-labelledby="entries-title" class="mb-7">
      <h2 id="entries-title" class="mb-3 text-[1.15rem] font-semibold">今天想做什么？</h2>
      <div class="space-y-3">
        <AppButton
          label="开始学习"
          description="选择医院挂号或手机打车"
          data-testid="start-learning"
          @activate="startLearning"
        >
          <template #icon>
            <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 5h16v14H4zM8 9h8M8 13h5" />
            </svg>
          </template>
        </AppButton>
        <AppButton
          label="AI 看图指导"
          description="AI 服务暂不可用，不影响模拟训练"
          variant="secondary"
          @activate="openAiHelper"
        >
          <template #icon>
            <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 5h16v14H4zM4 15l4-4 3 3 4-5 5 6" />
              <circle cx="9" cy="9" r="1.2" />
            </svg>
          </template>
        </AppButton>
      </div>
      <p
        v-if="notice"
        role="status"
        aria-live="polite"
        class="mt-3 rounded-2xl border-2 border-sg-border bg-sg-surface p-4"
        data-testid="notice"
      >
        {{ notice }}
      </p>
    </section>

    <section
      aria-labelledby="settings-title"
      class="mb-7 rounded-2xl border-2 border-sg-border bg-sg-surface p-4"
    >
      <h2 id="settings-title" class="mb-4 text-[1.15rem] font-semibold">看得清楚，用得舒服</h2>
      <FontScaleControl />
      <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t-2 border-sg-border pt-4">
        <div>
          <p class="font-semibold">语音播报偏好</p>
          <p class="text-[0.85rem] text-sg-muted">朗读功能将在 M2 阶段接入</p>
        </div>
        <button
          type="button"
          role="switch"
          :aria-checked="settings.voiceEnabled"
          class="min-h-tap min-w-[5.5rem] rounded-xl border-2 px-4 font-semibold"
          :class="
            settings.voiceEnabled
              ? 'border-sg-primary bg-sg-primary text-sg-primary-ink'
              : 'border-sg-border bg-sg-surface text-sg-ink'
          "
          @click="settings.setVoiceEnabled(!settings.voiceEnabled)"
        >
          {{ settings.voiceEnabled ? '已开启' : '已关闭' }}
        </button>
      </div>
    </section>

    <footer class="text-center text-[0.85rem] text-sg-muted">
      SilverGuide · M1 基础产品 · 无需注册
    </footer>
  </main>
</template>
