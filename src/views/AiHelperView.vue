<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { analyzeScreenshot } from '@/services/ai/visionClient';
import { guardVisionAnalysis } from '@/services/aiResponseValidator';
import { checkImageFile, prepareScreenshot } from '@/services/imageService';
import { toNormalizedRect } from '@/utils/coordinates';
import type { VisionAnalysisOutcome } from '@/types/vision';
import SpeechControls from '@/components/SpeechControls.vue';
import { pwa } from '@/services/pwaService';
import { warnDiagnostic } from '@/utils/diagnostics';

const image = ref<Blob | null>(null);
const previewUrl = ref('');
const question = ref('');
const taskContext = ref('');
const consent = ref(false);
const preparing = ref(false);
const loading = ref(false);
const message = ref('');
const outcome = ref<VisionAnalysisOutcome | null>(null);
const annotation = ref(true);
let generation = 0;
let activeRequest: AbortController | null = null;

const analysis = computed(() => outcome.value ? guardVisionAnalysis(outcome.value.analysis, question.value, taskContext.value) : undefined);
const rect = computed(() => {
  const result = analysis.value;
  return annotation.value && result?.status === 'success' && !result.safetyWarning && result.boundingBox
    ? toNormalizedRect(result.boundingBox) : null;
});
const online = pwa.online;
const canAnalyze = computed(() => online.value && !!image.value && consent.value && !loading.value && !preparing.value);
watch([question, taskContext], () => { if (!loading.value) outcome.value = null; });

function cancelAnalysis(): void {
  generation++;
  activeRequest?.abort();
  activeRequest = null;
  loading.value = false;
  preparing.value = false;
  outcome.value = null;
}

function clearImage(): void {
  cancelAnalysis();
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = '';
  image.value = null;
  consent.value = false;
  annotation.value = true;
  message.value = '';
}

async function selectImage(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const selected = input.files?.[0];
  input.value = '';
  if (!selected) return;
  clearImage();
  const check = checkImageFile(selected);
  if (!check.ok) { message.value = check.message; return; }
  const version = generation;
  preparing.value = true;
  try {
    const prepared = await prepareScreenshot(selected);
    if (version !== generation) return;
    const url = URL.createObjectURL(prepared);
    image.value = prepared;
    previewUrl.value = url;
  } catch (error) {
    warnDiagnostic('vision.prepareImage', error);
    if (version === generation) message.value = '图片读取或处理失败，请重新选择清晰的截图。';
  } finally {
    if (version === generation) preparing.value = false;
  }
}

async function submit(): Promise<void> {
  if (!canAnalyze.value || !image.value) return;
  const version = ++generation;
  const controller = new AbortController();
  activeRequest = controller;
  loading.value = true;
  outcome.value = null;
  annotation.value = true;
  message.value = '';
  try {
    const result = await analyzeScreenshot({ image: image.value, question: question.value, taskContext: taskContext.value }, { signal: controller.signal });
    if (generation === version) outcome.value = result;
  } catch (error) {
    warnDiagnostic('vision.submit', error);
    if (generation === version) message.value = '分析未能完成，请稍后重试。';
  } finally {
    if (generation === version) { loading.value = false; activeRequest = null; }
  }
}

function cancel(): void {
  cancelAnalysis();
  message.value = '已取消等待，可以重新分析。';
}
onBeforeUnmount(clearImage);
</script>

<template>
  <main class="mx-auto w-full max-w-[40rem] px-4 pb-12 pt-6">
    <header class="mb-5">
      <h1 class="text-[1.5rem] font-bold">AI 看图指导</h1>
      <p class="mt-2 text-sg-muted">选一张手机截图，告诉我想做什么。AI 将尝试解释界面，并给出下一步建议。</p>
      <p v-if="!online" role="status" class="mt-3 rounded-xl border-2 border-sg-warn p-3 font-semibold text-sg-warn">当前没有网络，请联网后再分析，或<RouterLink class="underline" to="/practice">继续模拟训练</RouterLink>。</p>
    </header>
    <section aria-labelledby="upload-title" class="mb-5 rounded-2xl border-2 border-sg-border bg-sg-surface p-4">
      <h2 id="upload-title" class="font-bold">1. 选择截图</h2>
      <p class="my-2 rounded-xl border-2 border-sg-warn p-3 text-sg-warn">请先遮挡姓名、手机号、银行卡号、密码和验证码等隐私信息。确认分析后，图片才会发送给 AI 服务。</p>
      <label for="screenshot" class="block font-semibold">上传图片（PNG、JPEG、WebP、GIF，最大 5MB）</label>
      <input id="screenshot" data-testid="screenshot-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="mt-2 block w-full min-w-0 rounded-xl border-2 border-sg-border p-2" @change="selectImage" />
      <p v-if="preparing" role="status" class="mt-3">正在读取图片…</p>
      <p v-if="message" role="status" class="mt-3 text-sg-warn" data-testid="image-notice">{{ message }}</p>
      <div v-if="previewUrl" class="mt-4">
        <div class="relative w-full overflow-hidden rounded-xl border border-sg-border">
          <img :src="previewUrl" alt="您选择的截图" class="block h-auto w-full" />
          <svg v-if="rect" data-testid="annotation" class="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="AI 建议操作区域">
            <rect v-bind="rect" fill="#ffdb00" fill-opacity="0.18" stroke="#111827" stroke-width="6" vector-effect="non-scaling-stroke" />
            <rect v-bind="rect" fill="none" stroke="#ffdb00" stroke-width="3" vector-effect="non-scaling-stroke" />
          </svg>
        </div>
        <div class="mt-2 flex flex-wrap gap-2">
          <button v-if="analysis?.boundingBox && !analysis.safetyWarning" type="button" class="min-h-tap rounded-xl border-2 border-sg-primary px-3 font-semibold text-sg-primary" @click="annotation = !annotation">{{ annotation ? '隐藏标注' : '显示标注' }}</button>
          <button type="button" class="min-h-tap rounded-xl border-2 border-sg-border px-3 font-semibold" @click="clearImage">移除截图</button>
        </div>
      </div>
    </section>
    <section aria-labelledby="question-title" class="mb-5 rounded-2xl border-2 border-sg-border bg-sg-surface p-4">
      <h2 id="question-title" class="font-bold">2. 告诉 AI 想做什么（可选）</h2>
      <label for="task-context" class="mt-3 block font-semibold">操作目标</label>
      <select id="task-context" v-model="taskContext" :disabled="loading" class="min-h-tap w-full rounded-xl border-2 border-sg-border bg-sg-surface p-2">
        <option value="">暂不选择</option><option value="预约挂号">预约挂号</option><option value="手机打车">手机打车</option><option value="了解页面">了解页面</option>
      </select>
      <label for="question" class="mt-3 block font-semibold">想问的问题</label>
      <textarea id="question" v-model="question" :disabled="loading" maxlength="300" rows="3" class="w-full resize-y rounded-xl border-2 border-sg-border bg-sg-surface p-3" placeholder="例如：我应该点击哪里？" />
      <p class="text-[0.85rem] text-sg-muted">不填写也可以，AI 会先介绍页面主要功能。</p>
      <label class="my-3 flex min-h-tap items-start gap-3 rounded-xl border-2 border-sg-border p-3">
        <input v-model="consent" data-testid="privacy-consent" :disabled="!image || loading" type="checkbox" class="mt-1 h-6 w-6 shrink-0 accent-blue-700" />
        <span>我已检查截图并同意将其发送给 AI 分析。</span>
      </label>
      <button type="button" data-testid="analyze" :disabled="!canAnalyze" class="min-h-tap w-full rounded-xl bg-sg-primary px-4 py-3 font-bold text-sg-primary-ink disabled:opacity-50" @click="submit">{{ outcome ? '重新分析' : '开始分析' }}</button>
      <div v-if="loading" role="status" aria-live="polite" class="mt-3 rounded-xl bg-sg-bg p-3">
        正在分析，请耐心等待。<button type="button" class="mt-2 block min-h-tap w-full rounded-xl border-2 border-sg-border font-semibold" @click="cancel">取消等待</button>
      </div>
    </section>
    <section v-if="analysis" aria-labelledby="result-title" class="rounded-2xl border-2 border-sg-border bg-sg-surface p-4" data-testid="ai-result" aria-live="polite">
      <h2 id="result-title" class="font-bold">3. {{ analysis.status === 'failed' ? '分析未完成' : analysis.safetyWarning ? '安全提醒（系统保护）' : 'AI 分析结果' }}</h2>
      <p v-if="analysis.status === 'uncertain' && !analysis.safetyWarning" class="mt-3 font-semibold text-sg-warn">AI 不能可靠确认目标位置，请不要仅凭建议操作。</p>
      <p v-if="analysis.pageSummary" class="mt-3 text-sg-muted">{{ analysis.pageSummary }}</p>
      <p class="mt-3 rounded-xl border-2 border-sg-primary p-3 font-bold">{{ analysis.instruction }}</p>
      <p v-if="analysis.targetLabel" class="mt-2">可能的目标：{{ analysis.targetLabel }}</p>
      <p v-if="analysis.confidence !== null" class="mt-2 text-[0.85rem] text-sg-muted">AI 自报告置信度：{{ Math.round(analysis.confidence * 100) }}%（不代表正确率）</p>
      <p v-if="analysis.safetyWarning" class="mt-3 rounded-xl border-2 border-sg-warn p-3 font-semibold text-sg-warn">安全提醒：{{ analysis.safetyWarning }}</p>
      <SpeechControls :text="[analysis.pageSummary, analysis.instruction, analysis.safetyWarning].filter(Boolean).join('。')" />
      <p v-if="outcome?.degraded" class="mt-3 text-sg-muted">您仍可返回训练中心继续不依赖 AI 的练习。</p>
      <RouterLink v-if="outcome?.degraded" to="/practice" class="mt-3 block min-h-tap rounded-xl border-2 border-sg-primary p-2 text-center font-semibold text-sg-primary">返回模拟训练</RouterLink>
    </section>
    <p class="mt-5 text-[0.85rem] text-sg-muted">仅供学习参考；AI 不会代替您完成真实业务。截图不会保存在本机学习档案中。</p>
  </main>
</template>
