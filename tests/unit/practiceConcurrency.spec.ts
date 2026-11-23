import 'fake-indexeddb/auto';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePracticeStore } from '@/stores/practice';
import { progressRepository } from '@/repositories/progressRepository';
import type { PracticeRecord } from '@/repositories/progressRepository';
import { createEngineSession, SNAPSHOT_SCHEMA_VERSION } from '@/engine/taskEngine';
import type { TaskEngineSnapshot } from '@/engine/taskEngine';
import { HOSPITAL_TASK, TAXI_TASK } from '@/tasks/demoData';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  await progressRepository.clear();
  setActivePinia(createPinia());
});

describe('审查回归：任务选择 last-write-wins 与 IndexedDB 提交顺序', () => {
  it('医院读取挂起时切换打车，旧加载即使最后返回也不能覆盖新任务', async () => {
    const store = usePracticeStore();
    const blocked = deferred<PracticeRecord | null>();
    const realRead = progressRepository.getLatestActive.bind(progressRepository);
    const read = vi.spyOn(progressRepository, 'getLatestActive').mockImplementation((id, version) => id === HOSPITAL_TASK.id ? blocked.promise : realRead(id, version));
    const first = store.loadTask(HOSPITAL_TASK.id);
    await vi.waitFor(() => expect(read).toHaveBeenCalledWith(HOSPITAL_TASK.id, HOSPITAL_TASK.version));
    const second = store.loadTask(TAXI_TASK.id);
    expect(store.currentTaskId).toBe(TAXI_TASK.id);
    expect(store.snapshot).toBeNull();
    expect(store.loading).toBe(true);
    await second;
    blocked.resolve(null);
    await first;
    expect(store.currentTaskId).toBe(TAXI_TASK.id);
    expect(store.snapshot?.session.taskId).toBe(TAXI_TASK.id);
    expect(store.loading).toBe(false);
    expect((await progressRepository.list()).map(r => r.taskId)).toEqual([TAXI_TASK.id]);
  });

  it('旧任务的统计返回时新任务尚在读取，不得清除新任务 loading', async () => {
    const store = usePracticeStore();
    const oldCount = deferred<number>(); const newRead = deferred<PracticeRecord | null>();
    const realRead = progressRepository.getLatestActive.bind(progressRepository);
    const realCount = progressRepository.countCompleted.bind(progressRepository);
    const read = vi.spyOn(progressRepository, 'getLatestActive').mockImplementation((id, version) => id === TAXI_TASK.id ? newRead.promise : realRead(id, version));
    const count = vi.spyOn(progressRepository, 'countCompleted').mockImplementation((id, version) => id === HOSPITAL_TASK.id ? oldCount.promise : realCount(id, version));
    const first = store.loadTask(HOSPITAL_TASK.id);
    await vi.waitFor(() => expect(count).toHaveBeenCalledWith(HOSPITAL_TASK.id, HOSPITAL_TASK.version));
    const second = store.loadTask(TAXI_TASK.id);
    await vi.waitFor(() => expect(read).toHaveBeenCalledWith(TAXI_TASK.id, TAXI_TASK.version));
    oldCount.resolve(100); await first;
    expect(store.loading).toBe(true);
    expect(store.snapshot).toBeNull();
    newRead.resolve(null); await second;
    expect(store.snapshot?.session.taskId).toBe(TAXI_TASK.id);
    expect(store.snapshot?.session.currentHintLevel).toBe(1);
  });

  it('无效路由也会取消在途任务加载', async () => {
    const store = usePracticeStore();
    const blocked = deferred<PracticeRecord | null>();
    const read = vi.spyOn(progressRepository, 'getLatestActive').mockReturnValueOnce(blocked.promise);
    const pending = store.loadTask(HOSPITAL_TASK.id);
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    await store.loadTask('not-a-task');
    blocked.resolve(null); await pending;
    expect(store.currentTaskId).toBe('not-a-task');
    expect(store.currentTask).toBeUndefined();
    expect(store.snapshot).toBeNull();
    expect(store.loading).toBe(false);
    expect(await progressRepository.list()).toEqual([]);
  });

  it('重启旧任务等待统计时切换任务，不得覆盖新的快照', async () => {
    const store = usePracticeStore(); await store.loadTask(HOSPITAL_TASK.id);
    const oldCount = deferred<number>(); const realCount = progressRepository.countCompleted.bind(progressRepository);
    const count = vi.spyOn(progressRepository, 'countCompleted').mockImplementation((id, version) => id === HOSPITAL_TASK.id ? oldCount.promise : realCount(id, version));
    const restart = store.restart();
    await vi.waitFor(() => expect(count).toHaveBeenCalledWith(HOSPITAL_TASK.id, HOSPITAL_TASK.version));
    await store.loadTask(TAXI_TASK.id);
    oldCount.resolve(5); await restart;
    expect(store.currentTaskId).toBe(TAXI_TASK.id);
    expect(store.snapshot?.session.taskId).toBe(TAXI_TASK.id);
    expect(store.loading).toBe(false);
    expect((await progressRepository.list()).filter(r => r.taskId === HOSPITAL_TASK.id)).toHaveLength(1);
  });

  it('快速连续点击时先保存步骤2再保存步骤3，不会出现倒序覆盖', async () => {
    const store = usePracticeStore(); await store.loadTask(HOSPITAL_TASK.id);
    const blocked = deferred<void>(); const realSave = progressRepository.save.bind(progressRepository);
    const save = vi.spyOn(progressRepository, 'save').mockImplementationOnce(async (snapshot, version, now, generation) => { await blocked.promise; return realSave(snapshot, version, now, generation); });
    const first = store.activate('hospital-home-entry');
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    const second = store.activate('hospital-registration-button');
    expect(store.snapshot?.currentStepId).toBe('hospital-select-department');
    expect(save.mock.calls[0]?.[0].currentStepId).toBe('hospital-open-registration');
    expect(save).toHaveBeenCalledOnce();
    blocked.resolve(undefined); await Promise.all([first, second]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0].currentStepId).toBe('hospital-select-department');
    expect((await progressRepository.getLatestActive(HOSPITAL_TASK.id, HOSPITAL_TASK.version))?.snapshot.currentStepId).toBe('hospital-select-department');
  });

  it('写入挂起时切走再切回，恢复等待最新写入而非读取旧步骤', async () => {
    const store = usePracticeStore(); await store.loadTask(HOSPITAL_TASK.id);
    const originalId = store.snapshot?.session.id;
    const blocked = deferred<void>(); const realSave = progressRepository.save.bind(progressRepository);
    const save = vi.spyOn(progressRepository, 'save').mockImplementationOnce(async (snapshot, version, now, generation) => { await blocked.promise; return realSave(snapshot, version, now, generation); });
    const write = store.activate('hospital-home-entry');
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    const read = vi.spyOn(progressRepository, 'getLatestActive');
    const switchAway = store.loadTask(TAXI_TASK.id);
    const switchBack = store.loadTask(HOSPITAL_TASK.id);
    expect(store.currentTaskId).toBe(HOSPITAL_TASK.id);
    expect(read).not.toHaveBeenCalled();
    blocked.resolve(undefined); await Promise.all([write, switchAway, switchBack]);
    expect(store.snapshot?.session.id).toBe(originalId);
    expect(store.snapshot?.currentStepId).toBe('hospital-open-registration');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('前一次写入失败不影响后一次保存，只记录无隐私的异常类别', async () => {
    const store = usePracticeStore(); await store.loadTask(HOSPITAL_TASK.id);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(progressRepository, 'save').mockRejectedValueOnce(new DOMException('private-record-details', 'QuotaExceededError'));
    await Promise.all([store.activate('hospital-home-entry'), store.activate('hospital-registration-button')]);
    expect((await progressRepository.getLatestActive(HOSPITAL_TASK.id, HOSPITAL_TASK.version))?.snapshot.currentStepId).toBe('hospital-select-department');
    expect(store.persistenceWarning).toBe('');
    expect(warn).toHaveBeenCalledWith('[SilverGuide]', 'practice.save', { errorType: 'QuotaExceededError' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-record-details');
    warn.mockRestore();
  });

  it('清除记录等待所有在途写入且不会被迟到保存复活', async () => {
    const store = usePracticeStore(); await store.loadTask(HOSPITAL_TASK.id);
    const blocked = deferred<void>(); const realSave = progressRepository.save.bind(progressRepository);
    const save = vi.spyOn(progressRepository, 'save').mockImplementationOnce(async (snapshot, version, now, generation) => { await blocked.promise; return realSave(snapshot, version, now, generation); });
    const write = store.activate('hospital-home-entry');
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    const clear = vi.spyOn(progressRepository, 'clear');
    const clearPending = store.clearRecords();
    expect(clear).not.toHaveBeenCalled();
    await store.activate('hospital-registration-button');
    expect(save).toHaveBeenCalledOnce();
    blocked.resolve(undefined); await write;
    expect(await clearPending).toBe(true);
    expect(store.snapshot).toBeNull();
    expect(store.records).toEqual([]);
    expect(await progressRepository.list()).toEqual([]);
  });

  it('清除记录使尚未结束的读取失效，不能重新创建会话', async () => {
    const store = usePracticeStore();
    const blocked = deferred<PracticeRecord | null>();
    const read = vi.spyOn(progressRepository, 'getLatestActive').mockReturnValueOnce(blocked.promise);
    const load = store.loadTask(HOSPITAL_TASK.id);
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(await store.clearRecords()).toBe(true);
    blocked.resolve(null); await load;
    expect(store.currentTaskId).toBe('');
    expect(store.snapshot).toBeNull();
    expect(await progressRepository.list()).toEqual([]);
  });

  it('清除过程中导航到新任务，清除后只加载最新任务', async () => {
    const store = usePracticeStore(); await store.loadTask(HOSPITAL_TASK.id);
    const blocked = deferred<void>(); const realClear = progressRepository.clear.bind(progressRepository);
    const clear = vi.spyOn(progressRepository, 'clear').mockImplementationOnce(async () => { await blocked.promise; return realClear(); });
    const pending = store.clearRecords();
    await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce());
    const load = store.loadTask(TAXI_TASK.id);
    expect(store.currentTaskId).toBe(TAXI_TASK.id);
    expect(store.snapshot).toBeNull();
    blocked.resolve(undefined); expect(await pending).toBe(true); await load;
    expect(store.snapshot?.session.taskId).toBe(TAXI_TASK.id);
    expect((await progressRepository.list()).map(r => r.taskId)).toEqual([TAXI_TASK.id]);
  });

  it('旧版同任务快照迁移后保留会话 ID、步骤和计数', async () => {
    const store = usePracticeStore();
    const initial = createEngineSession(HOSPITAL_TASK, { id: 'legacy-session', now: '2026-01-01T00:00:00.000Z', hintLevel:2 });
    const legacy = { session: { ...initial.session, helpCount: 3 }, currentStepId: HOSPITAL_TASK.steps[1]!.id, consecutiveErrors: 0, optionalField: 'metadata' };
    vi.spyOn(progressRepository, 'getLatestActive').mockResolvedValueOnce({ id: initial.session.id, taskId: HOSPITAL_TASK.id, taskVersion: HOSPITAL_TASK.version, startedAt: initial.session.startedAt, updatedAt: initial.session.startedAt, snapshot: legacy as unknown as TaskEngineSnapshot });
    await store.loadTask(HOSPITAL_TASK.id);
    expect(store.snapshot).toMatchObject({ schemaVersion: SNAPSHOT_SCHEMA_VERSION, currentStepId: legacy.currentStepId, session: { id: initial.session.id, helpCount: 3, currentHintLevel: 2 } });
    expect((await progressRepository.list())[0]?.snapshot?.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(store.notice).toContain('恢复');
  });

  it('已退出会话与非法提示等级的操作不产生多余写入', async () => {
    const store = usePracticeStore(); await store.loadTask(HOSPITAL_TASK.id);
    const save = vi.spyOn(progressRepository, 'save');
    await store.setHintLevel(99 as 3);
    expect(save).not.toHaveBeenCalled();
    await store.abandon();
    expect(save).toHaveBeenCalledOnce();
    const snapshot = store.snapshot;
    await Promise.all([store.activate('hospital-home-entry'), store.requestHelp(), store.goBack(), store.setHintLevel(2), store.abandon()]);
    expect(store.snapshot).toBe(snapshot);
    expect(save).toHaveBeenCalledOnce();
    expect(store.snapshot?.session.status).toBe('abandoned');
  });

  it('独立 store 清除后，另一个旧会话不能恢复已清除记录', async () => {
    const first = usePracticeStore(createPinia());
    const second = usePracticeStore(createPinia());
    await first.loadTask(HOSPITAL_TASK.id);
    await second.clearRecords();
    // 即便没有 observer 通知，事务层也拒绝旧保存。
    await first.activate('hospital-home-entry');
    expect(await progressRepository.list()).toEqual([]);
    expect(first.snapshot).toBeNull();
    expect(first.notice).toContain('其他页面已清除');
    await first.loadTask(HOSPITAL_TASK.id);
    expect(first.snapshot?.session.status).toBe('active');
    expect(await progressRepository.list()).toHaveLength(1);
  });

  it('观察代次变化时，其他页面的状态立即失效', async () => {
    const first = usePracticeStore(createPinia());
    const second = usePracticeStore(createPinia());
    await first.loadTask(HOSPITAL_TASK.id);
    const unsubscribe = first.observeArchive();
    try {
      await second.clearRecords();
      await vi.waitFor(() => expect(first.snapshot).toBeNull());
      expect(first.records).toEqual([]);
    } finally { unsubscribe(); }
  });
});
