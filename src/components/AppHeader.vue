<script setup lang="ts">
import { RouterLink } from 'vue-router';

const links = [
  { to: '/', label: '首页', exact: true },
  { to: '/practice', label: '模拟训练', exact: false },
  { to: '/ai-helper', label: 'AI 看图', exact: true },
  { to: '/progress', label: '学习档案', exact: true },
  { to: '/settings', label: '设置', exact: true },
];
</script>

<template>
  <header class="border-b-2 border-sg-border bg-sg-surface">
    <div class="mx-auto w-full max-w-[48rem] px-4 py-3">
      <RouterLink
        to="/"
        class="inline-flex min-h-tap items-center gap-2 font-bold text-sg-ink"
        aria-label="银龄引路人首页"
      >
        <span
          class="flex h-10 w-10 items-center justify-center rounded-xl bg-sg-primary text-sg-primary-ink"
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v3m0 12v3M3 12h3m12 0h3" />
            <circle cx="12" cy="12" r="4" />
          </svg>
        </span>
        银龄引路人
      </RouterLink>
      <nav class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="主要导航">
        <RouterLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="flex min-h-tap items-center justify-center rounded-xl border-2 border-transparent px-2 py-2 text-center text-[0.9rem] font-semibold"
          active-class="border-sg-primary bg-sg-bg text-sg-primary"
          :exact-active-class="link.exact ? 'border-sg-primary bg-sg-primary text-sg-primary-ink' : ''"
        >
          {{ link.label }}
        </RouterLink>
      </nav>
    </div>
  </header>
</template>
