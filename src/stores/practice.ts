import { defineStore } from 'pinia';
import {
  abandonEngineSession,
  createEngineSession,
  getDefaultHintLevel,
  goBackEngineStep,
  isHintLevel,
  performEngineAction,
  requestEngineHelp,
  restartEngineSession,
  restoreEngineSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
  setEngineHintLevel,
} from '@/engine/taskEngine';
import type { TaskEngineSnapshot } from '@/engine/taskEngine';
import { compareHistory, progressRepository, StaleProgressGenerationError, toHistoryRecord } from '@/repositories/progressRepository';
import type { HistoryRecord, PracticeRecord } from '@/repositories/progressRepository';
import { getTaskById } from '@/tasks';
import { useSettingsStore } from '@/stores/settings';
import type { HintLevel } from '@/types';
import { createId } from '@/utils/id';
import { warnDiagnostic } from '@/utils/diagnostics';

function isoNow(): string {
  return new Date().toISOString();
}

function upsertRecord(records: HistoryRecord[], record: PracticeRecord): HistoryRecord[] {
  return [toHistoryRecord(record), ...records.filter((item) => item.id !== record.id)].sort(compareHistory);
}

// 非响应式、每个 Pinia store 实例独立的运行时协调状态，不写入学习快照。
interface PracticeRuntime {
  requestSeq: number;
  dbTail: Promise<void>;
  clearing: boolean;
  clearPromise: Promise<boolean> | null;
  knownGeneration: number | null;
  sessionGeneration: number | null;
}

const runtimes = new WeakMap<object, PracticeRuntime>();
function runtimeFor(store: object): PracticeRuntime {
  let runtime = runtimes.get(store);
  if (!runtime) {
    runtime = { requestSeq: 0, dbTail: Promise.resolve(), clearing: false, clearPromise: null, knownGeneration: null, sessionGeneration: null };
    runtimes.set(store, runtime);
  }
  return runtime;
}

/** 同一 store 的保存、列表读取与清除按提交顺序执行；失败不会毒化后续队列。 */
function enqueueDb<T>(runtime: PracticeRuntime, operation: () => Promise<T>): Promise<T> {
  const pending = runtime.dbTail.then(operation);
  runtime.dbTail = pending.then(() => undefined, () => undefined);
  return pending;
}

function captureSnapshot(snapshot: TaskEngineSnapshot): TaskEngineSnapshot {
  return { schemaVersion: snapshot.schemaVersion, currentStepId: snapshot.currentStepId,
    consecutiveErrors: snapshot.consecutiveErrors, session: { ...snapshot.session } };
}

export const usePracticeStore = defineStore('practice', {
  state: () => ({
    snapshot: null as TaskEngineSnapshot | null,
    currentTaskId: '',
    records: [] as HistoryRecord[],
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
    /** 代次是持久化事实；跨标签页通知仅负责及时更新界面。 */
    syncGeneration(generation: number): void {
      const runtime = runtimeFor(this);
      const previous = runtime.knownGeneration;
      if (previous !== null && generation <= previous) return;
      runtime.knownGeneration = generation;
      if (previous === null || runtime.clearing) return;
      ++runtime.requestSeq;
      runtime.sessionGeneration = null;
      this.snapshot = null;
      this.records = [];
      this.feedback = '';
      this.helpVisible = false;
      this.loading = false;
      this.persistenceWarning = '';
      this.notice = '其他页面已清除学习记录。请重新开始练习。';
    },

    observeArchive(): () => void {
      return progressRepository.observeGeneration(
        generation => this.syncGeneration(generation),
        error => warnDiagnostic('practice.observe', error),
      );
    },

    async flushPendingWrites(): Promise<boolean> {
      const runtime = runtimeFor(this);
      let pending: Promise<void>;
      do { pending = runtime.dbTail; await pending; } while (pending !== runtime.dbTail);
      return !this.loading && !runtime.clearing && (!this.snapshot || !this.persistenceWarning);
    },

    async loadTask(taskId: string): Promise<void> {
      const runtime = runtimeFor(this);
      const task = getTaskById(taskId);
      // 同一已加载的 active 会话可继续；任何新选择都立即更新任务 ID。
      const existing = this.persistenceWarning && !this.loading && !runtime.clearing && task && this.currentTaskId === taskId &&
          this.snapshot?.session.taskId === taskId && this.snapshot.session.status === 'active' ? captureSnapshot(this.snapshot) : null;
      const existingGeneration = runtime.sessionGeneration;
      const sequence = ++runtime.requestSeq;
      this.currentTaskId = taskId;
      this.snapshot = null;
      runtime.sessionGeneration = null;
      this.feedback = '';
      this.notice = '';
      this.persistenceWarning = '';
      this.helpVisible = false;
      this.loading = !!task;
      if (!task) return;
      const settings = useSettingsStore();
      try {
        // 等待此前已发起的写入或清除，防止切回任务时读取较旧的存档。
        await runtime.dbTail;
        if (sequence !== runtime.requestSeq) return;
        let restored: TaskEngineSnapshot | null = null;
        let completedCount = 0;
        let incompatible = false;
        let needsMigration = false;
        let readFailed = false;
        try {
          const generation = await progressRepository.getGeneration();
          if (sequence !== runtime.requestSeq) return;
          // 可能是在跨页通知到达之前主动读取到新代次；正在加载的旧快照不得被复用。
          if (runtime.knownGeneration !== null && generation < runtime.knownGeneration) return;
          if (runtime.knownGeneration !== null && generation > runtime.knownGeneration) this.records = [];
          runtime.knownGeneration = generation;
          runtime.sessionGeneration = generation;
          const active = await progressRepository.getLatestActive(task.id, task.version);
          if (sequence !== runtime.requestSeq) return;
          restored = active && toHistoryRecord(active).snapshot ? restoreEngineSnapshot(task, active.snapshot) : null;
          incompatible = !!active && !restored;
          needsMigration = !!restored && active?.snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION;
          completedCount = await progressRepository.countCompleted(task.id, task.version);
          if (sequence !== runtime.requestSeq) return;
          const latestGeneration = await progressRepository.getGeneration();
          if (sequence !== runtime.requestSeq) return;
          if (latestGeneration !== generation) { this.syncGeneration(latestGeneration); return; }
          if (restored && existing && existingGeneration === generation && restored.session.id === existing.session.id) {
            restored = existing;
            needsMigration = true; // 重试尚未保存的内存进度，但绝不覆盖更新的会话。
          }
        } catch (error) {
          warnDiagnostic('practice.loadTask', error);
          if (sequence !== runtime.requestSeq) return;
          readFailed = true;
          this.persistenceWarning = '当前浏览器无法读取本地记录。您可以继续练习，但刷新后可能丢失进度。';
        }

        if (restored) {
          this.snapshot = restored;
          this.notice = '已恢复上次的练习，可以从离开的步骤继续。';
          if (needsMigration) await this.persistSnapshot();
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
          this.notice = incompatible ? '上次练习记录格式不兼容或损坏，已开始新练习；原记录仍保留。'
            : readFailed ? '暂时无法读取上次练习记录，已开始新的练习。'
            : completedCount > 0 ? '欢迎再次练习，这次可以减少一点提示。' : '';
          await this.persistSnapshot();
        }
      } finally {
        // 过期请求不得结束新请求的 loading 状态。
        if (sequence === runtime.requestSeq) this.loading = false;
      }
    },

    async activate(elementId: string): Promise<void> {
      const task = this.currentTask;
      if (!task || !this.snapshot || this.loading || runtimeFor(this).clearing ||
          this.snapshot.session.taskId !== task.id || this.snapshot.session.status !== 'active') return;
      const result = performEngineAction(task, this.snapshot, elementId, 'click', isoNow());
      this.snapshot = result.snapshot;
      this.feedback = result.feedback;
      this.helpVisible = false;
      await this.persistSnapshot();
    },

    async requestHelp(): Promise<void> {
      const task = this.currentTask;
      if (!task || !this.snapshot || this.loading || runtimeFor(this).clearing ||
          this.snapshot.session.taskId !== task.id || this.snapshot.session.status !== 'active') return;
      const result = requestEngineHelp(task, this.snapshot);
      this.snapshot = result.snapshot;
      this.feedback = result.feedback;
      this.helpVisible = true;
      await this.persistSnapshot();
    },

    async goBack(): Promise<void> {
      const task = this.currentTask;
      if (!task || !this.snapshot || this.loading || runtimeFor(this).clearing ||
          this.snapshot.session.taskId !== task.id || this.snapshot.session.status !== 'active') return;
      const result = goBackEngineStep(task, this.snapshot);
      this.snapshot = result.snapshot;
      this.feedback = result.feedback;
      this.helpVisible = false;
      if (result.accepted) await this.persistSnapshot();
    },

    async setHintLevel(level: HintLevel): Promise<void> {
      if (!this.snapshot || this.loading || runtimeFor(this).clearing || !isHintLevel(level) ||
          this.snapshot.session.taskId !== this.currentTaskId || this.snapshot.session.status !== 'active') return;
      this.snapshot = setEngineHintLevel(this.snapshot, level);
      this.feedback = `已切换为${level === 1 ? '详细指导' : level === 2 ? '简短指导' : '独立练习'}。`;
      this.helpVisible = false;
      await this.persistSnapshot();
    },

    async restart(): Promise<void> {
      const runtime = runtimeFor(this);
      const task = this.currentTask;
      const snapshot = this.snapshot;
      if (!task || !snapshot || this.loading || runtime.clearing || snapshot.session.taskId !== task.id) return;
      const sequence = ++runtime.requestSeq;
      const settings = useSettingsStore();
      this.loading = true;
      try {
        if (snapshot.session.status === 'active') {
          this.snapshot = abandonEngineSession(snapshot);
          await this.persistSnapshot();
        } else {
          await runtime.dbTail;
        }
        if (sequence !== runtime.requestSeq) return;
        let completedCount = 0;
        try {
          completedCount = await progressRepository.countCompleted(task.id, task.version);
          if (sequence !== runtime.requestSeq) return;
        } catch (error) {
          warnDiagnostic('practice.restart', error);
          if (sequence !== runtime.requestSeq) return;
          this.persistenceWarning = '无法读取历史次数，本次练习仍可正常进行。';
        }
        this.snapshot = restartEngineSession(task, snapshot, {
          id: createId('session'),
          now: isoNow(),
          hintLevel: getDefaultHintLevel(completedCount, settings.preferredHintLevel as HintLevel),
        });
        this.feedback = '';
        this.notice = '已重新开始，上一次记录仍保留在学习档案中。';
        this.helpVisible = false;
        await this.persistSnapshot();
      } finally {
        if (sequence === runtime.requestSeq) this.loading = false;
      }
    },

    async abandon(): Promise<void> {
      if (!this.snapshot || this.loading || runtimeFor(this).clearing ||
          this.snapshot.session.taskId !== this.currentTaskId || this.snapshot.session.status !== 'active') return;
      this.snapshot = abandonEngineSession(this.snapshot);
      await this.persistSnapshot();
    },

    async persistSnapshot(): Promise<void> {
      const runtime = runtimeFor(this);
      const task = this.currentTask;
      if (!task || !this.snapshot || runtime.clearing || this.snapshot.session.taskId !== task.id) return;
      // 必须在入队时捕获数据，不能在稍后的 await 中重新读取响应式快照。
      const snapshot = captureSnapshot(this.snapshot);
      const sequence = runtime.requestSeq;
      const generation = runtime.sessionGeneration;
      const isCurrent = () => sequence === runtime.requestSeq && this.snapshot?.session.id === snapshot.session.id;
      await enqueueDb(runtime, async () => {
        try {
          if (generation === null) throw new Error('Missing progress generation');
          const record = await progressRepository.save(snapshot, task.version, isoNow(), generation);
          if (runtime.knownGeneration !== generation) return;
          this.records = upsertRecord(this.records, record);
          if (isCurrent()) this.persistenceWarning = '';
        } catch (error) {
          if (error instanceof StaleProgressGenerationError) {
            this.syncGeneration(error.generation);
            return;
          }
          warnDiagnostic('practice.save', error);
          if (isCurrent()) this.persistenceWarning = '本次操作已在页面中生效，但无法保存到本地。请保持页面打开并检查浏览器存储权限。';
        }
      });
    },

    async loadRecords(): Promise<void> {
      const runtime = runtimeFor(this);
      const sequence = runtime.requestSeq;
      await enqueueDb(runtime, async () => {
        try {
          const generation = await progressRepository.getGeneration();
          const records = await progressRepository.list();
          const latest = await progressRepository.getGeneration();
          if (latest !== generation) { this.syncGeneration(latest); return; }
          if (runtime.knownGeneration !== null && generation < runtime.knownGeneration) return;
          this.syncGeneration(generation);
          this.records = records;
        } catch (error) {
          warnDiagnostic('practice.list', error);
          if (sequence === runtime.requestSeq) this.persistenceWarning = '暂时无法读取学习档案。模拟训练仍可正常使用。';
        }
      });
    },

    async clearRecords(): Promise<boolean> {
      const runtime = runtimeFor(this);
      if (runtime.clearPromise) return runtime.clearPromise;
      const sequence = ++runtime.requestSeq; // 使清除前尚未完成的读/重启失效。
      runtime.clearing = true;
      this.loading = true;
      const pending = enqueueDb(runtime, async () => {
        try {
          const generation = await progressRepository.clear();
          runtime.knownGeneration = Math.max(runtime.knownGeneration ?? generation, generation);
          runtime.sessionGeneration = null;
          this.records = [];
          // 清除期间若已导航到新任务，新的 loadTask 会在清除后重新开始。
          if (sequence === runtime.requestSeq) {
            this.snapshot = null;
            this.currentTaskId = '';
            this.feedback = '';
            this.helpVisible = false;
            this.notice = '学习记录已清除。';
            this.persistenceWarning = '';
          }
          return true;
        } catch (error) {
          warnDiagnostic('practice.clear', error);
          if (sequence === runtime.requestSeq) this.persistenceWarning = '学习记录未能清除，请检查浏览器存储权限后重试。';
          return false;
        } finally {
          runtime.clearing = false;
          if (sequence === runtime.requestSeq) this.loading = false;
        }
      });
      runtime.clearPromise = pending;
      try { return await pending; }
      finally { if (runtime.clearPromise === pending) runtime.clearPromise = null; }
    },
  },
});
