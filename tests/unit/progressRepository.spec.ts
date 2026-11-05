import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskEngineSnapshot } from '@/engine/taskEngine';
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
    currentStepId: 'step-1',
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
  await repository.save(snapshot('active-old'), 1, '2026-01-01T00:01:00.000Z');
  await repository.save(snapshot('active-new'), 1, '2026-01-01T00:02:00.000Z');
  await repository.save(snapshot('completed', 'completed'), 1, '2026-01-01T00:03:00.000Z');
  await repository.save(snapshot('future-version'), 2, '2026-01-01T00:04:00.000Z');

  expect((await repository.getLatestActive('hospital-registration', 1))?.id).toBe('active-new');
  expect(await repository.countCompleted('hospital-registration')).toBe(1);
  expect(await repository.countCompleted('taxi-ride')).toBe(0);
  expect((await repository.list()).map((record) => record.id)).toEqual([
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
    const saved = await repository.save(value, 1, '2026-01-01T00:01:00.000Z');
    saved.snapshot.session.errorCount = 99;
    value.session.errorCount = 88;
    const restored = await repository.getLatestActive('hospital-registration', 1);
    expect(restored?.snapshot.session.errorCount).toBe(1);
  });

  it('内存实现遵循同一接口，用于测试与明确的降级场景', async () => {
    await exerciseRepository(new InMemoryProgressRepository());
  });
});
