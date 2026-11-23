<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import AppButton from '@/components/AppButton.vue';
import ClearRecordsControl from '@/components/ClearRecordsControl.vue';
import { usePracticeStore } from '@/stores/practice';
import { getTaskById } from '@/tasks';
import { formatDateTime, formatDuration } from '@/utils/format';

const router = useRouter();
const practice = usePracticeStore();

onMounted(() => {
  void practice.loadRecords();
});

const completedCount = computed(
  () => practice.records.filter((record) => record.snapshot?.session.status === 'completed').length,
);
const activeCount = computed(
  () => practice.records.filter((record) => record.snapshot?.session.status === 'active').length,
);

</script>

<template>
  <main class="mx-auto w-full max-w-[40rem] px-4 pb-12 pt-6">
    <header class="mb-6">
      <h1 class="text-[1.5rem] font-bold">我的学习档案</h1>
      <p class="mt-2 text-sg-muted">记录只保存在当前浏览器中，不需要登录，也不会上传个人信息。</p>
    </header>

    <section class="mb-5 grid grid-cols-2 gap-3" aria-label="学习统计">
      <div class="rounded-2xl border-2 border-sg-border bg-sg-surface p-4 text-center">
        <strong class="block text-[1.8rem] text-sg-primary">{{ completedCount }}</strong>
        <span>已完成</span>
      </div>
      <div class="rounded-2xl border-2 border-sg-border bg-sg-surface p-4 text-center">
        <strong class="block text-[1.8rem] text-sg-primary">{{ activeCount }}</strong>
        <span>进行中</span>
      </div>
    </section>

    <p
      v-if="practice.persistenceWarning"
      role="status"
      class="mb-4 rounded-xl border-2 border-sg-border bg-sg-surface p-3"
    >
      {{ practice.persistenceWarning }}
    </p>

    <section v-if="practice.records.length" aria-labelledby="history-title">
      <h2 id="history-title" class="mb-3 text-[1.15rem] font-semibold">练习记录</h2>
      <ol class="space-y-4">
        <li
          v-for="record in practice.records"
          :key="record.id"
          class="rounded-2xl border-2 border-sg-border bg-sg-surface p-4"
          data-testid="progress-record"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 class="font-bold">{{ getTaskById(record.taskId)?.title ?? '旧版训练' }}</h3>
              <p class="text-[0.85rem] text-sg-muted">最近操作：{{ formatDateTime(record.updatedAt) }}</p>
            </div>
            <span class="rounded-lg bg-sg-bg px-2 py-1 text-[0.85rem] font-semibold">
              {{ !record.snapshot ? '记录不兼容' : record.snapshot.session.status === 'completed' ? '已完成' : record.snapshot.session.status === 'active' ? '进行中' : '已退出' }}
            </span>
          </div>
          <dl v-if="record.snapshot" class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[0.9rem]">
            <div><dt class="inline text-sg-muted">用时：</dt><dd class="inline">{{ formatDuration(record.startedAt, record.snapshot.session.completedAt) }}</dd></div>
            <div><dt class="inline text-sg-muted">错误：</dt><dd class="inline">{{ record.snapshot.session.errorCount }} 次</dd></div>
            <div><dt class="inline text-sg-muted">求助：</dt><dd class="inline">{{ record.snapshot.session.helpCount }} 次</dd></div>
            <div><dt class="inline text-sg-muted">提示：</dt><dd class="inline">L{{ record.snapshot.session.currentHintLevel }}</dd></div>
          </dl>
          <p v-else class="mt-3 text-sg-muted">这条记录暂时无法读取，原始记录仍保留。您可以重新练习，也可以清除学习记录。</p>
        </li>
      </ol>
    </section>
    <section v-else class="rounded-2xl border-2 border-sg-border bg-sg-surface p-5 text-center">
      <h2 class="font-bold">还没有练习记录</h2>
      <p class="my-3 text-sg-muted">完成一次挂号或打车训练后，结果会显示在这里。</p>
      <AppButton label="去开始第一次练习" @activate="router.push('/practice')" />
    </section>
    <ClearRecordsControl class="mt-5" label="清除本机学习记录" :can-clear="practice.records.length > 0" />
  </main>
</template>
