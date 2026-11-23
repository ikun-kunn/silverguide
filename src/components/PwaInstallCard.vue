<script setup lang="ts">
import { pwa } from '@/services/pwaService';
import { usePracticeStore } from '@/stores/practice';
const practice = usePracticeStore();
const { installed, ios, prompt, message, offlineReady, updateReady, updating } = pwa;
</script>

<template>
  <section v-if="prompt || installed || ios || message || offlineReady || updateReady" class="mb-6 rounded-2xl border-2 border-sg-border bg-sg-surface p-4" aria-labelledby="pwa-title">
    <h2 id="pwa-title" class="font-bold">在手机上随时练习</h2>
    <div v-if="updateReady" class="mt-2 rounded-xl border-2 border-sg-primary p-3" role="status">
      <p class="font-semibold">已准备好新版本。当前页面可继续使用，方便时再更新。</p>
      <button type="button" data-testid="pwa-update" :disabled="updating" class="mt-2 min-h-tap rounded-xl bg-sg-primary px-4 py-2 font-bold text-sg-primary-ink disabled:opacity-50" @click="pwa.applyUpdate(() => practice.flushPendingWrites())">更新到新版本</button>
    </div>
    <p v-if="installed" class="mt-2 text-sg-muted">已经安装到设备，可以从应用图标打开。</p>
    <p v-else-if="ios" class="mt-2 text-sg-muted">在支持安装的 iPhone 或 iPad 浏览器中，打开分享菜单，选择「添加到主屏幕」。</p>
    <button v-else-if="prompt" type="button" data-testid="pwa-install" class="mt-3 min-h-tap w-full rounded-xl border-2 border-sg-primary px-4 py-2 font-bold text-sg-primary" @click="pwa.install()">安装到设备</button>
    <p v-if="offlineReady" class="mt-2 text-sg-muted" data-testid="pwa-ready">离线练习页面已准备好；AI 看图指导仍需要网络。</p>
    <p v-if="message" role="status" class="mt-2">{{ message }}</p>
  </section>
</template>
