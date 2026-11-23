import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskEngineSnapshot } from '@/engine/taskEngine';
import { SNAPSHOT_SCHEMA_VERSION } from '@/engine/taskEngine';
import { HOSPITAL_TASK } from '@/tasks/demoData';
import {
  DexieProgressRepository,
  InMemoryProgressRepository,
  SilverGuideDatabase,
} from '@/repositories/progressRepository';
import type { ProgressStore } from '@/repositories/progressRepository';

const databases: SilverGuideDatabase[] = [];

function snapshot(
  id: string,
  status: 'active' | 'completed' | 'abandoned' = 'active',
): TaskEngineSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    currentStepId: status === 'completed' ? HOSPITAL_TASK.steps.at(-1)!.id : HOSPITAL_TASK.steps[0]!.id,
    consecutiveErrors: 0,
    session: {
      id,
      taskId: 'hospital-registration',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: status === 'completed' ? '2026-01-01T00:03:00.000Z' : null,
      status,
      errorCount: 1,
      helpCount: 2,
      currentHintLevel: 1,
    },
  };
}

async function exerciseRepository(repository: ProgressStore): Promise<void> {
  const generation = await repository.getGeneration();
  await repository.save(snapshot('active-old'), 1, '2026-01-01T00:01:00.000Z', generation);
  await repository.save(snapshot('active-new'), 1, '2026-01-01T00:02:00.000Z', generation);
  await repository.save(snapshot('completed', 'completed'), 1, '2026-01-01T00:03:00.000Z', generation);
  await repository.save(snapshot('future-version'), 2, '2026-01-01T00:04:00.000Z', generation);
  await repository.save(snapshot('completed-v2', 'completed'), 2, '2026-01-01T00:05:00.000Z', generation);
  await repository.save(snapshot('completed-v2-extra', 'completed'), 2, '2026-01-01T00:06:00.000Z', generation);

  expect(await repository.getLatestActive('hospital-registration', 1)).toBeNull();
  expect(await repository.countCompleted('hospital-registration', 1)).toBe(1);
  expect(await repository.countCompleted('hospital-registration', 2)).toBe(2);
  expect(await repository.countCompleted('hospital-registration', 3)).toBe(0);
  expect(await repository.countCompleted('taxi-ride', 1)).toBe(0);
  expect((await repository.list()).map((record) => record.id)).toEqual([
    'completed-v2-extra',
    'completed-v2',
    'future-version',
    'completed',
    'active-new',
    'active-old',
  ]);

  await repository.clear();
  expect(await repository.list()).toEqual([]);
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('Dexie 本地进度存储（TRD §3.8 / NFR-006）', () => {
  it('保存、按版本恢复、统计、排序与清除均可用', async () => {
    const database = new SilverGuideDatabase(`silverguide-test-${crypto.randomUUID()}`);
    databases.push(database);
    await exerciseRepository(new DexieProgressRepository(database));
  });

  it('保存结果使用副本，调用方后续修改不会绕过仓储写入', async () => {
    const database = new SilverGuideDatabase(`silverguide-test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new DexieProgressRepository(database);
    const value = snapshot('copy-check');
    const saved = await repository.save(value, 1, '2026-01-01T00:01:00.000Z', await repository.getGeneration());
    saved.snapshot.session.errorCount = 99;
    value.session.errorCount = 88;
    const restored = await repository.getLatestActive('hospital-registration', 1);
    expect(restored?.snapshot.session.errorCount).toBe(1);
  });

  it('内存实现遵循同一接口，用于测试与明确的降级场景', async () => {
    await exerciseRepository(new InMemoryProgressRepository());
  });

  it('两个独立连接中，清除前的代次不能重新写入旧记录', async () => {
    const database = new SilverGuideDatabase(`silverguide-test-${crypto.randomUUID()}`);
    const second = new SilverGuideDatabase(database.name);
    databases.push(database);
    const firstRepo = new DexieProgressRepository(database);
    const secondRepo = new DexieProgressRepository(second);
    try {
      const oldGeneration = await firstRepo.getGeneration();
      await firstRepo.save(snapshot('old'), 1, '2026-01-01T00:01:00.000Z', oldGeneration);
      const newGeneration = await secondRepo.clear();
      expect(newGeneration).toBe(oldGeneration + 1);
      await expect(firstRepo.save(snapshot('old'), 1, '2026-01-01T00:02:00.000Z', oldGeneration)).rejects.toMatchObject({ name: 'StaleProgressGenerationError', generation: newGeneration });
      expect(await secondRepo.list()).toEqual([]);
      await firstRepo.save(snapshot('new'), 1, '2026-01-01T00:03:00.000Z', newGeneration);
      expect((await secondRepo.list()).map(record => record.id)).toEqual(['new']);
    } finally { second.close(); }
  });

  it('损坏的记录保留原始数据，仅输出安全的不兼容摘要', async () => {
    const database = new SilverGuideDatabase(`silverguide-test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new DexieProgressRepository(database);
    const raw = { id: 'invalid-record', taskId: HOSPITAL_TASK.id, taskVersion: HOSPITAL_TASK.version,
      startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z' };
    await database.progress.put(raw as unknown as import('@/repositories/progressRepository').PracticeRecord);
    expect(await repository.list()).toEqual([{ ...raw, snapshot: null }]);
    expect(await database.progress.get('invalid-record')).toEqual(raw);
    expect(await repository.countCompleted(HOSPITAL_TASK.id, HOSPITAL_TASK.version)).toBe(0);
    await repository.clear();
    expect(await repository.list()).toEqual([]);
  });

  it('从 v1 数据库升级到 v2 时保留已有练习档案', async () => {
    const name = `silverguide-test-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(1).stores({ progress: '&id, taskId, taskVersion, [taskId+taskVersion], startedAt, updatedAt' });
    const value = snapshot('existing');
    await old.table('progress').put({ id: value.session.id, taskId: value.session.taskId, taskVersion: HOSPITAL_TASK.version,
      startedAt: value.session.startedAt, updatedAt: value.session.startedAt, snapshot: value });
    old.close();
    const database = new SilverGuideDatabase(name);
    databases.push(database);
    const repository = new DexieProgressRepository(database);
    expect(await repository.getGeneration()).toBe(0);
    expect((await repository.getLatestActive(value.session.taskId, HOSPITAL_TASK.version))?.snapshot).toEqual(value);
  });
});
