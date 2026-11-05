<script setup lang="ts">
/** TRD §4.2：按钮高度不低于 48px，图标与文字标签同时存在 */
withDefaults(
  defineProps<{
    label: string;
    description?: string;
    variant?: 'primary' | 'secondary';
    disabled?: boolean;
  }>(),
  { description: '', variant: 'primary', disabled: false },
);

const emit = defineEmits<{ (event: 'activate'): void }>();
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    class="flex min-h-tap w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left"
    :class="
      variant === 'primary'
        ? 'border-sg-primary bg-sg-primary text-sg-primary-ink'
        : 'border-sg-primary bg-sg-surface text-sg-primary'
    "
    @click="emit('activate')"
  >
    <span
      class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-current"
      aria-hidden="true"
    >
      <slot name="icon" />
    </span>
    <span class="min-w-0 flex-1">
      <span class="block text-[1.05rem] font-bold">{{ label }}</span>
      <span v-if="description" class="block text-[0.85rem] opacity-90">{{ description }}</span>
    </span>
    <span class="shrink-0 text-[1.5rem] leading-none" aria-hidden="true">›</span>
  </button>
</template>
