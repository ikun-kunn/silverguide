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
  <div class="rounded-2xl border-2 border-sg-border bg-sg-surface p-4" data-testid="hospital-simulation">
    <div class="mb-4 border-b-2 border-sg-border pb-3">
      <p class="font-bold">安康演示医院</p>
      <p class="text-[0.85rem] text-sg-warn">虚构医院 · 仅用于学习</p>
    </div>

    <section v-if="props.stepIndex === 0" aria-label="进入医院首页">
      <h2 class="text-[1.2rem] font-bold">欢迎来到模拟医院</h2>
      <p class="my-3 text-sg-muted">这里不会连接真实医院。准备好后，进入演示服务首页。</p>
      <SimulationButton v-bind="targetProps(props.targetElementId, true)" label="进入医院首页" @activate="emit('activate', $event)" />
    </section>

    <section v-else-if="props.stepIndex === 1" aria-label="医院服务首页">
      <h2 class="mb-3 text-[1.2rem] font-bold">医院服务</h2>
      <div class="space-y-3">
        <SimulationButton v-bind="targetProps(props.targetElementId, true)" label="预约挂号" description="选择科室和就诊时间" @activate="emit('activate', $event)" />
        <SimulationButton element-id="hospital-reports" label="查看检查报告" @activate="emit('activate', $event)" />
      </div>
    </section>

    <section v-else-if="props.stepIndex === 2" aria-label="选择科室">
      <h2 class="mb-3 text-[1.2rem] font-bold">请选择科室</h2>
      <div class="space-y-3">
        <SimulationButton v-bind="targetProps(props.targetElementId, true)" label="全科门诊" description="演示科室" @activate="emit('activate', $event)" />
        <SimulationButton element-id="hospital-surgery" label="普通外科" description="本次练习暂不选择" @activate="emit('activate', $event)" />
      </div>
    </section>

    <section v-else-if="props.stepIndex === 3" aria-label="选择日期和时段">
      <h2 class="mb-3 text-[1.2rem] font-bold">请选择就诊时间</h2>
      <p class="mb-3 text-sg-muted">全科门诊 · 演示号源</p>
      <div class="space-y-3">
        <SimulationButton v-bind="targetProps(props.targetElementId, true)" label="周一上午" description="演示时段" @activate="emit('activate', $event)" />
        <SimulationButton element-id="hospital-slot-afternoon" label="明天下午 3:00" description="本次练习暂不选择" @activate="emit('activate', $event)" />
      </div>
    </section>

    <section v-else-if="props.stepIndex === 4" aria-label="确认预约信息">
      <h2 class="mb-3 text-[1.2rem] font-bold">请核对预约信息</h2>
      <dl class="mb-4 space-y-2 rounded-xl bg-sg-bg p-4">
        <div><dt class="inline text-sg-muted">医院：</dt><dd class="inline">安康演示医院</dd></div>
        <div><dt class="inline text-sg-muted">科室：</dt><dd class="inline">全科门诊</dd></div>
        <div><dt class="inline text-sg-muted">时间：</dt><dd class="inline">周一上午</dd></div>
      </dl>
      <SimulationButton v-bind="targetProps(props.targetElementId, true)" label="确认模拟预约" description="不会产生真实医疗预约" @activate="emit('activate', $event)" />
    </section>

    <section v-else aria-label="模拟预约成功" class="text-center">
      <p class="text-[2rem]" aria-hidden="true">✓</p>
      <h2 class="text-[1.3rem] font-bold">预约信息已确认</h2>
      <p class="my-3 text-sg-muted">请查看本次模拟预约结果。没有向医院提交任何信息。</p>
      <SimulationButton v-bind="targetProps(props.targetElementId, true)" label="查看预约结果" @activate="emit('activate', $event)" />
    </section>
  </div>
</template>
