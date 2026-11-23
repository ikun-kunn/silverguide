import Dexie, { liveQuery } from 'dexie';
import type { Table } from 'dexie';
import type { TaskEngineSnapshot } from '@/engine/taskEngine';
import { restoreEngineSnapshot, SNAPSHOT_SCHEMA_VERSION } from '@/engine/taskEngine';
import { getTaskById } from '@/tasks';

/** IndexedDB 中的练习记录。任务状态与存储元数据分离，避免污染 TRD §6.3 的领域模型。 */
export interface PracticeRecord {
  id: string;
  taskId: string;
  taskVersion: number;
  startedAt: string;
  updatedAt: string;
  snapshot: TaskEngineSnapshot;
}

/** 不兼容记录仍显示在档案中；原始数据只留在数据库，不交给页面渲染。 */
export type HistoryRecord = Omit<PracticeRecord, 'snapshot'> & { snapshot: TaskEngineSnapshot | null };

export class StaleProgressGenerationError extends Error {
  constructor(readonly generation: number) { super('Learning records were cleared'); this.name = 'StaleProgressGenerationError'; }
}

export interface ProgressStore {
  getGeneration(): Promise<number>;
  observeGeneration(onChange: (generation: number) => void, onError: (error: unknown) => void): () => void;
  save(snapshot: TaskEngineSnapshot, taskVersion: number, now: string, generation: number): Promise<PracticeRecord>;
  getLatestActive(taskId: string, taskVersion: number): Promise<PracticeRecord | null>;
  countCompleted(taskId: string, taskVersion: number): Promise<number>;
  list(): Promise<HistoryRecord[]>;
  clear(): Promise<number>;
}

export class SilverGuideDatabase extends Dexie {
  progress!: Table<PracticeRecord, string>;
  metadata!: Table<{ key: string; generation: number }, string>;

  constructor(name = 'silverguide') {
    super(name);
    this.version(1).stores({
      progress: '&id, taskId, taskVersion, [taskId+taskVersion], startedAt, updatedAt',
    });
    // 升级仅新增元数据表，保留所有 v1 学习档案。
    this.version(2).stores({
      progress: '&id, taskId, taskVersion, [taskId+taskVersion], startedAt, updatedAt',
      metadata: '&key',
    });
  }
}

const GENERATION_KEY = 'progress-generation';

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/** 读路径只构造安全摘要；不可恢复的记录不会被删除或计入完成次数。 */
export function toHistoryRecord(raw: PracticeRecord, index = 0): HistoryRecord {
  const id = typeof raw?.id === 'string' && raw.id ? raw.id : `incompatible-${index}`;
  const taskId = typeof raw?.taskId === 'string' ? raw.taskId : '';
  const taskVersion = Number.isInteger(raw?.taskVersion) && raw.taskVersion > 0 ? raw.taskVersion : 0;
  const startedAt = validDate(raw?.startedAt) ? raw.startedAt : '';
  const updatedAt = validDate(raw?.updatedAt) ? raw.updatedAt : '';
  const task = getTaskById(taskId);
  const restored = task && taskVersion && startedAt && updatedAt ? restoreEngineSnapshot(task, raw.snapshot) : null;
  const snapshot = restored && restored.session.id === id && restored.session.startedAt === startedAt ? restored : null;
  return { id, taskId, taskVersion, startedAt, updatedAt, snapshot };
}

export function compareHistory(left: Pick<HistoryRecord, 'updatedAt' | 'startedAt' | 'id'>, right: Pick<HistoryRecord, 'updatedAt' | 'startedAt' | 'id'>): number {
  const time = (value: string) => validDate(value) ? Date.parse(value) : 0;
  return time(right.updatedAt) - time(left.updatedAt) || time(right.startedAt) - time(left.startedAt) || String(right.id).localeCompare(String(left.id));
}

/** 与训练中心共享最新会话口径，不越过较新的已完成/已退出记录恢复旧会话。 */
export function latestPracticeRecord<T extends Pick<HistoryRecord, 'taskId' | 'taskVersion' | 'updatedAt' | 'startedAt' | 'id'>>(records: T[], taskId: string, taskVersion: number): T | undefined {
  return records.filter(record => record?.taskId === taskId && record.taskVersion === taskVersion).sort(compareHistory)[0];
}

function toRecord(
  snapshot: TaskEngineSnapshot,
  taskVersion: number,
  now: string,
): PracticeRecord {
  return {
    id: snapshot.session.id,
    taskId: snapshot.session.taskId,
    taskVersion,
    startedAt: snapshot.session.startedAt,
    updatedAt: now,
    snapshot: {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      currentStepId: snapshot.currentStepId,
      consecutiveErrors: snapshot.consecutiveErrors,
      session: { ...snapshot.session },
    },
  };
}

/** TRD §3.8 / §5.1：无需登录的 IndexedDB + Dexie 本地学习档案。 */
export class DexieProgressRepository implements ProgressStore {
  constructor(private readonly db: SilverGuideDatabase = new SilverGuideDatabase()) {}

  async getGeneration(): Promise<number> {
    return (await this.db.metadata.get(GENERATION_KEY))?.generation ?? 0;
  }

  observeGeneration(onChange: (generation: number) => void, onError: (error: unknown) => void): () => void {
    const subscription = liveQuery(() => this.getGeneration()).subscribe({ next: onChange, error: onError });
    return () => subscription.unsubscribe();
  }

  async save(
    snapshot: TaskEngineSnapshot,
    taskVersion: number,
    now: string,
    generation: number,
  ): Promise<PracticeRecord> {
    const record = toRecord(snapshot, taskVersion, now);
    // 代次读取和写入位于同一事务，和 clear 的事务互斥（包括其他标签页）。
    await this.db.transaction('rw', this.db.progress, this.db.metadata, async () => {
      const current = await this.getGeneration();
      if (generation !== current) throw new StaleProgressGenerationError(current);
      await this.db.progress.put(record);
    });
    return structuredClone(record);
  }

  async getLatestActive(taskId: string, taskVersion: number): Promise<PracticeRecord | null> {
    const records = await this.db.progress
      .where('[taskId+taskVersion]')
      .equals([taskId, taskVersion])
      .toArray();
    const latest = latestPracticeRecord(records, taskId, taskVersion);
    return latest?.snapshot?.session?.status === 'active' ? structuredClone(latest) : null;
  }

  async countCompleted(taskId: string, taskVersion: number): Promise<number> {
    return this.db.progress
      .where('[taskId+taskVersion]')
      .equals([taskId, taskVersion])
      .filter((record) => toHistoryRecord(record).snapshot?.session.status === 'completed')
      .count();
  }

  async list(): Promise<HistoryRecord[]> {
    const records = await this.db.progress.toArray();
    return records.map(toHistoryRecord).sort(compareHistory);
  }

  async clear(): Promise<number> {
    return this.db.transaction('rw', this.db.progress, this.db.metadata, async () => {
      const generation = (await this.getGeneration()) + 1;
      await this.db.progress.clear();
      await this.db.metadata.put({ key: GENERATION_KEY, generation });
      return generation;
    });
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

/** 测试及存储不可用场景使用的内存实现；不会伪装成已持久化。 */
export class InMemoryProgressRepository implements ProgressStore {
  private readonly records = new Map<string, PracticeRecord>();
  private generation = 0;
  private readonly observers = new Set<(generation: number) => void>();

  async getGeneration(): Promise<number> { return this.generation; }
  observeGeneration(onChange: (generation: number) => void, _onError: (error: unknown) => void): () => void {
    this.observers.add(onChange);
    onChange(this.generation);
    return () => { this.observers.delete(onChange); };
  }

  async save(
    snapshot: TaskEngineSnapshot,
    taskVersion: number,
    now: string,
    generation: number,
  ): Promise<PracticeRecord> {
    if (generation !== this.generation) throw new StaleProgressGenerationError(this.generation);
    const record = toRecord(snapshot, taskVersion, now);
    this.records.set(record.id, record);
    return structuredClone(record);
  }

  async getLatestActive(taskId: string, taskVersion: number): Promise<PracticeRecord | null> {
    const latest = latestPracticeRecord([...this.records.values()], taskId, taskVersion);
    return latest?.snapshot?.session?.status === 'active' ? structuredClone(latest) : null;
  }

  async countCompleted(taskId: string, taskVersion: number): Promise<number> {
    return [...this.records.values()].filter(
      (record) =>
        record.taskId === taskId && record.taskVersion === taskVersion && toHistoryRecord(record).snapshot?.session.status === 'completed',
    ).length;
  }

  async list(): Promise<HistoryRecord[]> {
    return [...this.records.values()].map(toHistoryRecord).sort(compareHistory);
  }

  async clear(): Promise<number> {
    this.records.clear();
    this.generation += 1;
    for (const observer of this.observers) observer(this.generation);
    return this.generation;
  }
}

export const progressRepository: ProgressStore = new DexieProgressRepository();
