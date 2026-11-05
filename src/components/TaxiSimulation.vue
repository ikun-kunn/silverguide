<script setup lang="ts">
import SimulationButton from '@/components/SimulationButton.vue';

const props = defineProps<{
  stepIndex: number;
  targetElementId: string;
  highlighted: boolean;
}>();

const emit = defineEmits<{
  (event: 'activate', elementId: string): void;
}>();

function targetProps(elementId: string, primary = false) {
  return {
    elementId,
    highlighted: props.highlighted && props.targetElementId === elementId,
    variant: primary ? ('primary' as const) : ('secondary' as const),
  };
}
</script>

<template>
  <div class="rounded-2xl border-2 border-sg-border bg-sg-surface p-4" data-testid="taxi-simulation">
    <div class="mb-4 border-b-2 border-sg-border pb-3">
      <p class="font-bold">平安演示出行</p>
      <p class="text-[0.85rem] text-sg-warn">虚构应用 · 不会真实叫车或收费</p>
    </div>

    <section v-if="props.stepIndex === 0" aria-label="进入打车首页">
      <h2 class="text-[1.2rem] font-bold">欢迎来到模拟打车</h2>
      <p class="my-3 text-sg-muted">出发地固定为「演示社区北门」，无需定位或授权。</p>
      <SimulationButton v-bind="targetProps(props.targetElementId, true)" label="进入打车首页" @activate="emit('activate', $event)" />
    </section>

    <section v-else-if="props.stepIndex === 1" aria-label="选择虚拟目的地">
      <h2 class="mb-2 text-[1.2rem] font-bold">您要去哪里？</h2>
      <p class="mb-3 text-sg-muted">出发地：演示社区北门</p>
      <div class="space-y-3">
        <SimulationButton v-bind="targetProps(props.targetElementId, true)" label="市民公园" description="虚拟目的地" @activate="emit('activate', $event)" />
        <SimulationButton element-id="taxi-destination-station" label="火车站" description="本次练习暂不选择" @activate="emit('activate', $event)" />
      </div>
    </section>

    <section v-else-if="props.stepIndex === 2" aria-label="选择车型">
      <h2 class="mb-3 text-[1.2rem] font-bold">请选择车型</h2>
      <div class="space-y-3">
        <SimulationButton v-bind="targetProps(props.targetElementId, true)" label="舒适型" description="演示车型 · 4 座" @activate="emit('activate', $event)" />
        <SimulationButton element-id="taxi-car-six" label="六座商务车" description="本次练习暂不选择" @activate="emit('activate', $event)" />
      </div>
    </section>

    <section v-else-if="props.stepIndex === 3" aria-label="查看预估费用">
      <h2 class="mb-3 text-[1.2rem] font-bold">查看预估费用</h2>
      <div class="mb-4 rounded-xl bg-sg-bg p-4">
        <p>演示社区北门 → 市民公园</p>
        <p class="mt-2">舒适型 · 演示车型</p>
        <p class="text-[0.85rem] text-sg-warn">费用仅为演示，不会真实计价或扣款</p>
      </div>
      <SimulationButton v-bind="targetProps(props.targetElementId, true)" label="查看预估费用" @activate="emit('activate', $event)" />
    </section>

    <section v-else-if="props.stepIndex === 4" aria-label="确认模拟叫车">
      <h2 class="mb-3 text-[1.2rem] font-bold">请核对叫车信息</h2>
      <dl class="mb-4 space-y-2 rounded-xl bg-sg-bg p-4">
        <div><dt class="inline text-sg-muted">目的地：</dt><dd class="inline">市民公园</dd></div>
        <div><dt class="inline text-sg-muted">车型：</dt><dd class="inline">舒适型</dd></div>
        <div><dt class="inline text-sg-muted">预估：</dt><dd class="inline">¥28.00（演示）</dd></div>
      </dl>
      <SimulationButton v-bind="targetProps(props.targetElementId, true)" label="确认模拟叫车" description="不会生成真实订单" @activate="emit('activate', $event)" />
    </section>

    <section v-else aria-label="模拟叫车成功" class="text-center">
      <p class="text-[2rem]" aria-hidden="true">✓</p>
      <h2 class="text-[1.3rem] font-bold">叫车信息已确认</h2>
      <p class="my-3 text-sg-muted">请查看本次模拟叫车结果。没有车辆接单，也没有发生支付。</p>
      <SimulationButton v-bind="targetProps(props.targetElementId, true)" label="查看叫车结果" @activate="emit('activate', $event)" />
    </section>
  </div>
</template>
