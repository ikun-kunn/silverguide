<script setup lang="ts">
import type { HintLevel } from '@/types';

const props = defineProps<{
  modelValue: number;
  label?: string;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: HintLevel): void;
}>();

const options: Array<{ value: HintLevel; label: string; description: string }> = [
  { value: 1, label: '详细指导', description: '说明步骤并高亮按钮' },
  { value: 2, label: '简短指导', description: '只看简短文字说明' },
  { value: 3, label: '独立练习', description: '需要时再请求帮助' },
];
</script>

<template>
  <div role="group" :aria-label="props.label ?? '提示等级'">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="min-h-tap w-full rounded-xl border-2 px-4 py-3 text-left"
      :class="
        props.modelValue === option.value
          ? 'border-sg-primary bg-sg-primary text-sg-primary-ink'
          : 'border-sg-border bg-sg-surface text-sg-ink'
      "
      :aria-pressed="props.modelValue === option.value"
      :data-testid="`hint-level-${option.value}`"
      @click="emit('update:modelValue', option.value)"
    >
      <span class="block font-bold">{{ option.label }}</span>
      <span class="block text-[0.85rem] opacity-90">{{ option.description }}</span>
    </button>
  </div>
</template>
