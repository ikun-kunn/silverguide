<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { useRouter } from 'vue-router';
import AppButton from '@/components/AppButton.vue';
import HintLevelControl from '@/components/HintLevelControl.vue';
import HospitalSimulation from '@/components/HospitalSimulation.vue';
import TaxiSimulation from '@/components/TaxiSimulation.vue';
import SpeechControls from '@/components/SpeechControls.vue';
import { getCurrentStep, getStepHint } from '@/engine/taskEngine';
import { usePracticeStore } from '@/stores/practice';
import type { HintLevel } from '@/types';
import { formatDuration } from '@/utils/format';
import { warnDiagnostic } from '@/utils/diagnostics';

const props = defineProps<{ taskId: string }>();
const router = useRouter();
const practice = usePracticeStore();
let mounted = true;
let navigationGeneration = 0;
onBeforeUnmount(() => { mounted = false; navigationGeneration++; });

watch(
  () => props.taskId,
  (taskId) => {
    navigationGeneration++;
    void practice.loadTask(taskId);
  },
  { immediate: true, flush: 'sync' },
);

const currentStep = computed(() => {
  if (!practice.currentTask || !practice.snapshot) return null;
  try {
    return getCurrentStep(practice.currentTask, practice.snapshot);
  } catch (error) {
    warnDiagnostic('training.step', error);
    return null;
  }
});

const stepIndex = computed(() => {
  if (!practice.currentTask || !currentStep.value) return -1;
  return practice.currentTask.steps.findIndex((step) => step.id === currentStep.value?.id);
});

const showTarget = computed(
  () =>
    practice.snapshot?.session.status === 'active' && practice.snapshot.session.currentHintLevel === 1,
);

const guidance = computed(() => {
  if (!currentStep.value || practice.snapshot?.session.status !== 'active') return '';
  const level = practice.snapshot.session.currentHintLevel;
  if (practice.helpVisible) return getStepHint(currentStep.value, level);
  if (level === 3) {
    return '请独立试一次。如果不知道怎么做，可以点「帮我一下」。';
  }
  if (level === 2) {
    return getStepHint(currentStep.value, level);
  }
  return currentStep.value.instruction;
});

async function restart(): Promise<void> {
  await practice.restart();
}

async function exitPractice(): Promise<void> {
  const generation = navigationGeneration;
  const route = router.currentRoute?.value.fullPath;
  const sessionId = practice.snapshot?.session.id;
  await practice.abandon();
  if (mounted && generation === navigationGeneration && router.currentRoute?.value.fullPath === route &&
      practice.snapshot?.session.id === sessionId) await router.push('/practice');
}
</script>

<template>
  <main class="mx-auto w-full max-w-[40rem] px-4 pb-12 pt-5">
    <p v-if="practice.loading" role="status" class="rounded-xl bg-sg-surface p-4">正在读取本地练习记录…</p>

    <section v-else-if="!practice.currentTask" class="rounded-2xl border-2 border-sg-border bg-sg-surface p-5">
      <h1 class="text-[1.3rem] font-bold">没有找到这项训练</h1>
      <p class="my-3 text-sg-muted">可能是链接已失效，请返回训练中心重新选择。</p>
      <AppButton label="返回训练中心" @activate="router.push('/practice')" />
    </section>

    <template v-else>
      <header class="mb-4">
        <button
          type="button"
          class="min-h-tap rounded-lg px-2 font-semibold text-sg-primary"
          @click="router.push('/practice')"
        >
          ← 返回训练中心
        </button>
        <h1 class="mt-1 text-[1.45rem] font-bold">{{ practice.currentTask.title }}</h1>
        <p class="font-semibold text-sg-warn">模拟练习，不产生真实订单</p>
      </header>

      <p
        v-if="practice.persistenceWarning"
        role="alert"
        class="mb-4 rounded-xl border-2 border-sg-warn bg-sg-surface p-3 text-sg-warn"
      >
        {{ practice.persistenceWarning }}
      </p>
      <p
        v-if="practice.notice"
        role="status"
        class="mb-4 rounded-xl border-2 border-sg-border bg-sg-surface p-3"
        data-testid="practice-notice"
      >
        {{ practice.notice }}
      </p>

      <section v-if="practice.isCompleted && practice.snapshot" aria-labelledby="result-title" data-testid="practice-result">
        <div class="rounded-2xl border-2 border-sg-primary bg-sg-surface p-5">
          <p class="text-[2rem] text-sg-primary" aria-hidden="true">✓</p>
          <h2 id="result-title" class="text-[1.35rem] font-bold">
            {{ practice.currentTask.id === 'hospital-registration' ? '模拟预约成功' : '模拟叫车成功' }}，本次练习完成
          </h2>
          <p class="mt-2 text-sg-muted">您已经走完整个模拟流程。可以再练一次，逐步减少提示，试着自己完成。</p>
          <dl class="my-5 grid grid-cols-2 gap-3">
            <div class="rounded-xl bg-sg-bg p-3"><dt class="text-sg-muted">完成用时</dt><dd class="font-bold">{{ formatDuration(practice.snapshot.session.startedAt, practice.snapshot.session.completedAt) }}</dd></div>
            <div class="rounded-xl bg-sg-bg p-3"><dt class="text-sg-muted">错误操作</dt><dd class="font-bold">{{ practice.snapshot.session.errorCount }} 次</dd></div>
            <div class="rounded-xl bg-sg-bg p-3"><dt class="text-sg-muted">请求帮助</dt><dd class="font-bold">{{ practice.snapshot.session.helpCount }} 次</dd></div>
            <div class="rounded-xl bg-sg-bg p-3"><dt class="text-sg-muted">最终提示</dt><dd class="font-bold">L{{ practice.snapshot.session.currentHintLevel }}</dd></div>
          </dl>
          <div class="space-y-3">
            <AppButton label="再练一次" description="保留本次结果，开始新的练习" @activate="restart" />
            <AppButton label="查看学习档案" variant="secondary" @activate="router.push('/progress')" />
          </div>
        </div>
      </section>

      <section v-else-if="practice.snapshot?.session.status === 'abandoned'" class="rounded-2xl border-2 border-sg-border bg-sg-surface p-4">
        <h2 class="font-bold">本次练习已退出</h2>
        <p class="my-3">原有学习记录仍然保留。可以重新开始一次练习。</p>
        <AppButton label="重新开始" @activate="restart" />
      </section>

      <template v-else-if="practice.snapshot?.session.status === 'active' && currentStep && stepIndex >= 0">
        <section class="mb-4" aria-label="训练进度">
          <div class="mb-2 flex justify-between gap-3 text-[0.9rem] font-semibold">
            <span>第 {{ stepIndex + 1 }} 步，共 {{ practice.currentTask.steps.length }} 步</span>
            <span>提示 L{{ practice.snapshot.session.currentHintLevel }}</span>
          </div>
          <progress
            class="h-3 w-full accent-blue-700"
            :value="stepIndex + 1"
            :max="practice.currentTask.steps.length"
            :aria-label="`已完成到第 ${stepIndex + 1} 步`"
          />
        </section>

        <section
          id="current-target-help"
          class="mb-4 rounded-2xl border-2 border-sg-primary bg-sg-surface p-4"
          aria-labelledby="guidance-title"
          data-testid="guidance"
        >
          <h2 id="guidance-title" class="font-bold">现在要做的事</h2>
          <p class="mt-1">{{ guidance }}</p>
          <p v-if="showTarget" class="mt-2 font-semibold text-sg-primary">黄色边框和「点这里」标出了当前按钮。</p>
          <SpeechControls v-if="practice.snapshot.session.currentHintLevel !== 3 || practice.helpVisible" :text="guidance" />
        </section>

        <HospitalSimulation
          v-if="practice.currentTask.id === 'hospital-registration'"
          :step-index="stepIndex"
          :target-element-id="currentStep.targetElementId"
          :highlighted="showTarget"
          @activate="practice.activate"
        />
        <TaxiSimulation
          v-else-if="practice.currentTask.id === 'taxi-ride'"
          :step-index="stepIndex"
          :target-element-id="currentStep.targetElementId"
          :highlighted="showTarget"
          @activate="practice.activate"
        />

        <p
          v-if="practice.feedback"
          role="status"
          aria-live="polite"
          class="mt-4 rounded-xl border-2 border-sg-border bg-sg-surface p-4"
          data-testid="action-feedback"
        >
          {{ practice.feedback }}
        </p>

        <div class="mt-4 grid grid-cols-2 gap-3">
          <button type="button" class="min-h-tap rounded-xl border-2 border-sg-primary bg-sg-surface px-3 font-semibold text-sg-primary" @click="practice.requestHelp">帮我一下</button>
          <button type="button" class="min-h-tap rounded-xl border-2 border-sg-border bg-sg-surface px-3 font-semibold" @click="practice.goBack">返回上一步</button>
          <button type="button" class="min-h-tap rounded-xl border-2 border-sg-border bg-sg-surface px-3 font-semibold" @click="restart">重新开始</button>
          <button type="button" class="min-h-tap rounded-xl border-2 border-sg-border bg-sg-surface px-3 font-semibold" @click="exitPractice">退出练习</button>
        </div>

        <details class="mt-5 rounded-2xl border-2 border-sg-border bg-sg-surface p-4">
          <summary class="min-h-tap cursor-pointer font-semibold">调整提示等级</summary>
          <div class="mt-3 space-y-2">
            <HintLevelControl
              :model-value="practice.snapshot.session.currentHintLevel"
              @update:model-value="practice.setHintLevel($event as HintLevel)"
            />
          </div>
        </details>
      </template>

      <section v-else class="rounded-xl border-2 border-sg-warn bg-sg-surface p-4">
        <p role="status">当前练习无法继续。请选择重新开始。</p>
        <AppButton class="mt-3" label="重新开始练习" @activate="practice.loadTask(props.taskId)" />
      </section>
    </template>
  </main>
</template>
