<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    elementId: string;
    label: string;
    description?: string;
    highlighted?: boolean;
    variant?: 'primary' | 'secondary';
  }>(),
  { description: '', highlighted: false, variant: 'secondary' },
);

const emit = defineEmits<{
  (event: 'activate', elementId: string): void;
}>();
</script>

<template>
  <button
    :id="props.elementId"
    type="button"
    class="relative flex min-h-tap w-full items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 text-left font-semibold"
    :class="[
      props.variant === 'primary'
        ? 'border-sg-primary bg-sg-primary text-sg-primary-ink'
        : 'border-sg-border bg-sg-surface text-sg-ink',
      props.highlighted ? 'ring-4 ring-amber-500 ring-offset-2' : '',
    ]"
    :data-element-id="props.elementId"
    :aria-describedby="props.highlighted ? 'current-target-help' : undefined"
    @click="emit('activate', props.elementId)"
  >
    <span>
      <span class="block">{{ props.label }}</span>
      <span v-if="props.description" class="block text-[0.85rem] font-normal opacity-90">
        {{ props.description }}
      </span>
    </span>
    <span v-if="props.highlighted" class="shrink-0 font-bold" aria-hidden="true">← 点这里</span>
    <span v-else class="shrink-0 text-[1.3rem]" aria-hidden="true">›</span>
  </button>
</template>
