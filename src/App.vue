<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue';
import { RouterView } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';
import { useSettingsStore } from '@/stores/settings';
import { usePracticeStore } from '@/stores/practice';
import { pwa } from '@/services/pwaService';

const settings = useSettingsStore();
const practice = usePracticeStore();
let stopArchiveObservation = () => {};
const { online, offlineReady } = pwa;

onMounted(() => {
  settings.applyToDocument();
  pwa.initialize();
  stopArchiveObservation = practice.observeArchive();
});
onBeforeUnmount(() => { stopArchiveObservation(); pwa.dispose(); });
</script>

<template>
  <div class="min-h-screen bg-sg-bg text-sg-ink">
    <AppHeader />
    <p v-if="!online" role="status" class="mx-auto max-w-[40rem] px-4 py-2 font-semibold text-sg-warn" data-testid="offline-notice">
      {{ offlineReady ? '当前没有网络，模拟训练可离线使用；AI 看图暂不可用。' : '当前没有网络，AI 看图暂不可用。已打开的练习仍可继续。' }}
    </p>
    <RouterView />
  </div>
</template>
