<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';
import { useSettingsStore } from '@/stores/settings';

const settings = useSettingsStore();

onMounted(() => {
  settings.applyToDocument();
});
</script>

<template>
  <div class="min-h-screen bg-sg-bg text-sg-ink">
    <AppHeader />
    <RouterView />
  </div>
</template>
