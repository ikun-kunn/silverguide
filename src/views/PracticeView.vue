<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import AppButton from '@/components/AppButton.vue';
import { DEMO_TASKS } from '@/tasks';
import { latestPracticeRecord } from '@/repositories/progressRepository';
import { usePracticeStore } from '@/stores/practice';

const router = useRouter();
const practice = usePracticeStore();

onMounted(() => {
  void practice.loadRecords();
});

const hasRecords = computed(() => practice.records.length > 0);

function latestStatus(task: (typeof DEMO_TASKS)[number]): string {
  // 与 loadTask/getLatestActive 口径一致：只按当前任务版本判断状态，
  // 避免旧版 active 记录显示「继续练习」而实际新开练习。
  const latest = latestPracticeRecord(practice.records, task.id, task.version);
  if (!latest) return '尚未开始';
  if (!latest.snapshot) return '上次记录格式不兼容，可重新开始';
  if (latest.snapshot.session.status === 'active') return '上次练习可继续';
  if (latest.snapshot.session.status === 'completed') return '已完成，可再练一次';
  return '上次已退出，可重新开始';
}
</script>

<template>
  <main class="mx-auto w-full max-w-[40rem] px-4 pb-12 pt-6">
    <header class="mb-6">
      <h1 class="text-[1.5rem] font-bold">选择一项模拟训练</h1>
      <p class="mt-2 text-sg-muted">每次只练一件事。进入后会有清楚的步骤提示，也可以随时返回或重来。</p>
    </header>

    <p
      v-if="practice.persistenceWarning"
      role="alert"
      class="mb-4 rounded-xl border-2 border-sg-warn bg-sg-surface p-3 text-sg-warn"
    >
      {{ practice.persistenceWarning }}
    </p>

    <div class="space-y-5">
      <section
        v-for="task in DEMO_TASKS"
        :key="task.id"
        class="rounded-2xl border-2 border-sg-border bg-sg-surface p-4"
        :aria-labelledby="`task-${task.id}`"
      >
        <div class="mb-3 flex items-start gap-3">
          <span
            class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sg-bg text-[1.5rem]"
            aria-hidden="true"
          >
            {{ task.category === '医疗服务' ? '医' : '行' }}
          </span>
          <div>
            <h2 :id="`task-${task.id}`" class="text-[1.2rem] font-bold">{{ task.title }}</h2>
            <p class="mt-1 text-sg-muted">{{ task.description }}</p>
          </div>
        </div>
        <p class="mb-3 text-[0.9rem] font-semibold text-sg-primary" data-testid="task-status">
          {{ latestStatus(task) }}
        </p>
        <AppButton
          :label="latestStatus(task) === '上次练习可继续' ? '继续练习' : '开始模拟练习'"
          :description="`${task.steps.length} 个步骤 · 模拟练习，不产生真实订单`"
          @activate="router.push(`/practice/${task.id}`)"
        >
          <template #icon>
            <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14m-6-6 6 6-6 6" />
            </svg>
          </template>
        </AppButton>
      </section>
    </div>

    <p v-if="!hasRecords" class="mt-6 rounded-xl bg-sg-surface p-4 text-sg-muted">
      第一次练习会显示完整指导。完成后，可以从「学习档案」查看结果。
    </p>
  </main>
</template>
