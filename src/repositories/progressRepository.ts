import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { TaskEngineSnapshot } from '@/engine/taskEngine';

/** IndexedDB 中的练习记录。任务状态与存储元数据分离，避免污染 TRD §6.3 的领域模型。 */
export interface PracticeRecord {
  id: string;
  taskId: string;
  taskVersion: number;
  startedAt: string;
  updatedAt: string;
  snapshot: TaskEngineSnapshot;
}

export interface ProgressStore {
  save(snapshot: TaskEngineSnapshot, taskVersion: number, now: string): Promise<PracticeRecord>;
  getLatestActive(taskId: string, taskVersion: number): Promise<PracticeRecord | null>;
  countCompleted(taskId: string): Promise<number>;
  list(): Promise<PracticeRecord[]>;
  clear(): Promise<void>;
}

export class SilverGuideDatabase extends Dexie {
  progress!: Table<PracticeRecord, string>;

  constructor(name = 'silverguide') {
    super(name);
    this.version(1).stores({
      progress: '&id, taskId, taskVersion, [taskId+taskVersion], startedAt, updatedAt',
    });
  }
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
      currentStepId: snapshot.currentStepId,
      consecutiveErrors: snapshot.consecutiveErrors,
      session: { ...snapshot.session },
    },
  };
}

/** TRD §3.8 / §5.1：无需登录的 IndexedDB + Dexie 本地学习档案。 */
export class DexieProgressRepository implements ProgressStore {
  constructor(private readonly db: SilverGuideDatabase = new SilverGuideDatabase()) {}

  async save(
    snapshot: TaskEngineSnapshot,
    taskVersion: number,
    now: string,
  ): Promise<PracticeRecord> {
    const record = toRecord(snapshot, taskVersion, now);
    await this.db.progress.put(record);
    return structuredClone(record);
  }

  async getLatestActive(taskId: string, taskVersion: number): Promise<PracticeRecord | null> {
    const records = await this.db.progress
      .where('[taskId+taskVersion]')
      .equals([taskId, taskVersion])
      .toArray();
    const active = records
      .filter((record) => record.snapshot.session.status === 'active')
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return active[0] ? structuredClone(active[0]) : null;
  }

  async countCompleted(taskId: string): Promise<number> {
    return this.db.progress
      .where('taskId')
      .equals(taskId)
      .filter((record) => record.snapshot.session.status === 'completed')
      .count();
  }

  async list(): Promise<PracticeRecord[]> {
    const records = await this.db.progress.orderBy('updatedAt').reverse().toArray();
    return structuredClone(records);
  }

  async clear(): Promise<void> {
    await this.db.progress.clear();
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

/** 测试及存储不可用场景使用的内存实现；不会伪装成已持久化。 */
export class InMemoryProgressRepository implements ProgressStore {
  private readonly records = new Map<string, PracticeRecord>();

  async save(
    snapshot: TaskEngineSnapshot,
    taskVersion: number,
    now: string,
  ): Promise<PracticeRecord> {
    const record = toRecord(snapshot, taskVersion, now);
    this.records.set(record.id, record);
    return structuredClone(record);
  }

  async getLatestActive(taskId: string, taskVersion: number): Promise<PracticeRecord | null> {
    const active = [...this.records.values()]
      .filter(
        (record) =>
          record.taskId === taskId &&
          record.taskVersion === taskVersion &&
          record.snapshot.session.status === 'active',
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return active[0] ? structuredClone(active[0]) : null;
  }

  async countCompleted(taskId: string): Promise<number> {
    return [...this.records.values()].filter(
      (record) =>
        record.taskId === taskId && record.snapshot.session.status === 'completed',
    ).length;
  }

  async list(): Promise<PracticeRecord[]> {
    return structuredClone(
      [...this.records.values()].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    );
  }

  async clear(): Promise<void> {
    this.records.clear();
  }
}

export const progressRepository: ProgressStore = new DexieProgressRepository();
