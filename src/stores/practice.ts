import { defineStore } from 'pinia';
import {
  abandonEngineSession,
  createEngineSession,
  getDefaultHintLevel,
  goBackEngineStep,
  performEngineAction,
  requestEngineHelp,
  restartEngineSession,
  restoreEngineSnapshot,
  setEngineHintLevel,
} from '@/engine/taskEngine';
import type { TaskEngineSnapshot } from '@/engine/taskEngine';
import { progressRepository } from '@/repositories/progressRepository';
import type { PracticeRecord } from '@/repositories/progressRepository';
import { getTaskById } from '@/tasks';
import { useSettingsStore } from '@/stores/settings';
import type { HintLevel } from '@/types';
import { createId } from '@/utils/id';

function isoNow(): string {
  return new Date().toISOString();
}

function upsertRecord(records: PracticeRecord[], record: PracticeRecord): PracticeRecord[] {
  return [record, ...records.filter((item) => item.id !== record.id)].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export const usePracticeStore = defineStore('practice', {
  state: () => ({
    snapshot: null as TaskEngineSnapshot | null,
    currentTaskId: '',
    records: [] as PracticeRecord[],
    feedback: '',
    notice: '',
    persistenceWarning: '',
    helpVisible: false,
    loading: false,
  }),

  getters: {
    currentTask(state) {
      return getTaskById(state.currentTaskId);
    },
    isCompleted(state): boolean {
      return state.snapshot?.session.status === 'completed';
    },
  },

  actions: {
    async loadTask(taskId: string): Promise<void> {
      if (this.loading) return;
      const task = getTaskById(taskId);
      this.currentTaskId = taskId;
      this.feedback = '';
      this.notice = '';
      this.helpVisible = false;
      if (!task) {
        this.snapshot = null;
        return;
      }
      if (this.snapshot?.session.taskId === taskId && this.snapshot.session.status === 'active') {
        return;
      }

      this.loading = true;
      try {
        const settings = useSettingsStore();
        let restored: TaskEngineSnapshot | null = null;
        let completedCount = 0;
        try {
          const active = await progressRepository.getLatestActive(task.id, task.version);
          restored = active ? restoreEngineSnapshot(task, active.snapshot) : null;
          completedCount = await progressRepository.countCompleted(task.id);
        } catch {
          this.persistenceWarning = '当前浏览器无法读取本地记录。您可以继续练习，但刷新后可能丢失进度。';
        }

        if (restored) {
          this.snapshot = restored;
          this.notice = '已恢复上次的练习，可以从离开的步骤继续。';
        } else {
          const hintLevel = getDefaultHintLevel(
            completedCount,
            settings.preferredHintLevel as HintLevel,
          );
          this.snapshot = createEngineSession(task, {
            id: createId('session'),
            now: isoNow(),
            hintLevel,
          });
          this.notice = completedCount > 0 ? '欢迎再次练习，这次可以减少一点提示。' : '';
          await this.persistSnapshot();
        }
      } finally {
        this.loading = false;
      }
    },

    async activate(elementId: string): Promise<void> {
      const task = this.currentTask;
      if (!task || !this.snapshot || this.loading || this.isCompleted) return;
      const result = performEngineAction(task, this.snapshot, elementId, 'click', isoNow());
      this.snapshot = result.snapshot;
      this.feedback = result.feedback;
      this.helpVisible = false;
      await this.persistSnapshot();
    },

    async requestHelp(): Promise<void> {
      const task = this.currentTask;
      if (!task || !this.snapshot || this.isCompleted) return;
      const result = requestEngineHelp(task, this.snapshot);
      this.snapshot = result.snapshot;
      this.feedback = result.feedback;
      this.helpVisible = true;
      await this.persistSnapshot();
    },

    async goBack(): Promise<void> {
      const task = this.currentTask;
      if (!task || !this.snapshot || this.isCompleted) return;
      const result = goBackEngineStep(task, this.snapshot);
      this.snapshot = result.snapshot;
      this.feedback = result.feedback;
      this.helpVisible = false;
      await this.persistSnapshot();
    },

    async setHintLevel(level: HintLevel): Promise<void> {
      if (!this.snapshot || this.isCompleted) return;
      this.snapshot = setEngineHintLevel(this.snapshot, level);
      this.feedback = `已切换为${level === 1 ? '详细指导' : level === 2 ? '简短指导' : '独立练习'}。`;
      this.helpVisible = false;
      await this.persistSnapshot();
    },

    async restart(): Promise<void> {
      const task = this.currentTask;
      if (!task || !this.snapshot) return;
      if (this.snapshot.session.status === 'active') {
        this.snapshot = abandonEngineSession(this.snapshot);
        await this.persistSnapshot();
      }
      let completedCount = 0;
      try {
        completedCount = await progressRepository.countCompleted(task.id);
      } catch {
        this.persistenceWarning = '无法读取历史次数，本次练习仍可正常进行。';
      }
      const settings = useSettingsStore();
      this.snapshot = restartEngineSession(task, this.snapshot, {
        id: createId('session'),
        now: isoNow(),
        hintLevel: getDefaultHintLevel(
          completedCount,
          settings.preferredHintLevel as HintLevel,
        ),
      });
      this.feedback = '';
      this.notice = '已重新开始，上一次记录仍保留在学习档案中。';
      this.helpVisible = false;
      await this.persistSnapshot();
    },

    async abandon(): Promise<void> {
      if (!this.snapshot || this.snapshot.session.status !== 'active') return;
      this.snapshot = abandonEngineSession(this.snapshot);
      await this.persistSnapshot();
    },

    async persistSnapshot(): Promise<void> {
      const task = this.currentTask;
      if (!task || !this.snapshot) return;
      try {
        const record = await progressRepository.save(this.snapshot, task.version, isoNow());
        this.records = upsertRecord(this.records, record);
        this.persistenceWarning = '';
      } catch {
        this.persistenceWarning = '本次操作已在页面中生效，但无法保存到本地。请保持页面打开并检查浏览器存储权限。';
      }
    },

    async loadRecords(): Promise<void> {
      try {
        this.records = await progressRepository.list();
      } catch {
        this.persistenceWarning = '暂时无法读取学习档案。模拟训练仍可正常使用。';
      }
    },

    async clearRecords(): Promise<boolean> {
      try {
        await progressRepository.clear();
        this.records = [];
        this.snapshot = null;
        this.currentTaskId = '';
        this.feedback = '';
        this.notice = '学习记录已清除。';
        this.persistenceWarning = '';
        return true;
      } catch {
        this.persistenceWarning = '学习记录未能清除，请检查浏览器存储权限后重试。';
        return false;
      }
    },
  },
});
