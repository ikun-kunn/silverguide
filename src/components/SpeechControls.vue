<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getSpeechAvailability, observeSpeechAvailability, speakChinese, stopSpeech } from '@/services/speechService';
import { useSettingsStore } from '@/stores/settings';

const props = defineProps<{ text: string }>();
const settings = useSettingsStore();
const availability = ref(getSpeechAvailability());
let unsubscribe = () => {};
onMounted(() => { unsubscribe = observeSpeechAvailability(state => { availability.value = state; }); });
const message = ref('');
let generation = 0;

function play(): void {
  if (availability.value !== 'ready') return;
  const sequence = ++generation;
  message.value = '正在播报，可点停止。';
  if (!speakChinese(props.text, settings.voiceRate, {
    onEnd: () => { if (generation === sequence) message.value = '播报结束。'; },
    onError: () => { if (generation === sequence) message.value = '无法播报，请继续查看文字说明。'; },
  })) message.value = '无法播报，请继续查看文字说明。';
}
function stop(): void {
  generation++;
  stopSpeech();
  message.value = '已停止播报。';
}
watch(() => [props.text, settings.voiceEnabled], () => { generation++; stopSpeech(); message.value = ''; });
watch(availability, state => { if (state !== 'ready') { generation++; stopSpeech(); message.value = ''; } });
onBeforeUnmount(() => { unsubscribe(); generation++; stopSpeech(); });
</script>

<template>
  <div v-if="text" class="mt-3">
    <p v-if="availability === 'unsupported'" class="text-[0.85rem] text-sg-muted">当前浏览器不支持语音，仍可查看完整文字说明。</p>
    <p v-else-if="!settings.voiceEnabled" class="text-[0.85rem] text-sg-muted">语音已关闭，可在设置中打开。</p>
    <p v-else-if="availability === 'no-chinese'" role="status" class="text-[0.85rem] text-sg-muted">暂未检测到中文语音。请继续查看文字说明，中文语音加载后即可朗读。</p>
    <div v-else class="flex flex-wrap gap-2">
      <button type="button" class="min-h-tap rounded-xl border-2 border-sg-primary px-3 font-semibold text-sg-primary" @click="play">朗读说明</button>
      <button type="button" class="min-h-tap rounded-xl border-2 border-sg-border px-3 font-semibold" @click="stop">停止播报</button>
    </div>
    <p v-if="message" role="status" class="mt-2 text-[0.85rem] text-sg-muted">{{ message }}</p>
  </div>
</template>
