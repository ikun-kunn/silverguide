<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { usePracticeStore } from '@/stores/practice';

withDefaults(defineProps<{ label?: string; canClear?: boolean }>(), { label: '清除学习记录', canClear: true });
const practice = usePracticeStore();
const confirming = ref(false);
const busy = ref(false);
const message = ref('');
const cancelButton = ref<HTMLButtonElement | null>(null);
const openButton = ref<HTMLButtonElement | null>(null);

async function ask(): Promise<void> {
  confirming.value = true; message.value = '';
  await nextTick(); cancelButton.value?.focus();
}
async function cancel(): Promise<void> {
  confirming.value = false;
  await nextTick(); openButton.value?.focus();
}
async function confirm(): Promise<void> {
  if (!confirming.value || busy.value) return;
  busy.value = true;
  const success = await practice.clearRecords();
  busy.value = false; confirming.value = false;
  message.value = success ? '学习记录已清除，显示与声音偏好保持不变。' : '清除失败，请检查浏览器存储权限后重试。';
}
</script>

<template>
  <div>
    <button v-if="canClear && !confirming" ref="openButton" type="button" class="min-h-tap w-full rounded-xl border-2 border-sg-warn bg-sg-surface px-4 py-3 font-semibold text-sg-warn" @click="ask">{{ label }}</button>
    <div v-if="confirming" class="rounded-xl border-2 border-sg-warn bg-sg-surface p-3" role="group" aria-label="确认清除学习记录">
      <p class="mb-3 font-semibold">确认清除全部练习记录？清除后无法恢复。</p>
      <div class="flex flex-wrap gap-3">
        <button ref="cancelButton" type="button" :disabled="busy" class="min-h-tap flex-1 rounded-xl border-2 border-sg-primary bg-sg-primary px-3 font-semibold text-sg-primary-ink" @click="cancel">取消，保留记录</button>
        <button type="button" data-testid="confirm-clear-records" :disabled="busy" class="min-h-tap flex-1 rounded-xl border-2 border-sg-warn px-3 font-semibold text-sg-warn" @click="confirm">{{ busy ? '正在清除…' : '确认清除' }}</button>
      </div>
    </div>
    <p v-if="message" role="status" class="mt-3">{{ message }}</p>
  </div>
</template>
