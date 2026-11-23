import { describe, expect, it } from 'vitest';
import {
  abandonEngineSession,
  createEngineSession,
  getCurrentStep,
  getDefaultHintLevel,
  goBackEngineStep,
  performEngineAction,
  requestEngineHelp,
  restartEngineSession,
  restoreEngineSnapshot,
  setEngineHintLevel,
  SNAPSHOT_SCHEMA_VERSION,
} from '@/engine/taskEngine';
import type { TaskEngineSnapshot } from '@/engine/taskEngine';
import { HOSPITAL_TASK, TAXI_TASK } from '@/tasks/demoData';

const NOW = '2026-11-05T08:00:00.000Z';
const LATER = '2026-11-05T08:05:00.000Z';

function startSession(): TaskEngineSnapshot {
  return createEngineSession(HOSPITAL_TASK, { id: 'session-1', now: NOW, hintLevel: 3 });
}

function performCurrent(snapshot: TaskEngineSnapshot, now = LATER) {
  const step = getCurrentStep(HOSPITAL_TASK, snapshot);
  return performEngineAction(HOSPITAL_TASK, snapshot, step.targetElementId, step.expectedAction, now);
}

function completeHospital(): TaskEngineSnapshot {
  let snapshot = startSession();
  for (const step of HOSPITAL_TASK.steps) {
    expect(snapshot.currentStepId).toBe(step.id);
    snapshot = performEngineAction(
      HOSPITAL_TASK,
      snapshot,
      step.targetElementId,
      step.expectedAction,
      LATER,
    ).snapshot;
  }
  return snapshot;
}

describe('任务会话创建与步骤迁移', () => {
  it('创建 active 会话并定位到第一步，不读取系统时间或生成 ID', () => {
    const snapshot = startSession();
    expect(snapshot).toEqual({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      session: {
        id: 'session-1',
        taskId: HOSPITAL_TASK.id,
        startedAt: NOW,
        completedAt: null,
        status: 'active',
        errorCount: 0,
        helpCount: 0,
        currentHintLevel: 3,
      },
      currentStepId: HOSPITAL_TASK.steps[0]?.id,
      consecutiveErrors: 0,
    });
    expect(getCurrentStep(HOSPITAL_TASK, snapshot)).toBe(HOSPITAL_TASK.steps[0]);
  });

  it('正确操作前进一步，末步完成并注入 completedAt', () => {
    const initial = startSession();
    const first = performCurrent(initial);
    expect(first.accepted).toBe(true);
    expect(first.completed).toBe(false);
    expect(first.snapshot.currentStepId).toBe(HOSPITAL_TASK.steps[1]?.id);
    expect(initial.currentStepId).toBe(HOSPITAL_TASK.steps[0]?.id);

    const completed = completeHospital();
    expect(completed.session.status).toBe('completed');
    expect(completed.session.completedAt).toBe(LATER);
    expect(completed.currentStepId).toBe(HOSPITAL_TASK.steps.at(-1)?.id);
    expect(completed.consecutiveErrors).toBe(0);
  });

  it('当前步骤无效或任务不匹配时明确抛错', () => {
    expect(() => getCurrentStep(HOSPITAL_TASK, {
      ...startSession(),
      currentStepId: 'missing-step',
    })).toThrow('步骤不存在');
    expect(() => getCurrentStep(TAXI_TASK, startSession())).toThrow('不匹配');
  });

  it('已完成或已退出的会话不能继续执行动作', () => {
    const completed = completeHospital();
    const completedStep = getCurrentStep(HOSPITAL_TASK, completed);
    const afterCompleted = performEngineAction(
      HOSPITAL_TASK,
      completed,
      completedStep.targetElementId,
      completedStep.expectedAction,
      NOW,
    );
    expect(afterCompleted.accepted).toBe(false);
    expect(afterCompleted.completed).toBe(true);
    expect(afterCompleted.snapshot).toBe(completed);

    const abandoned = abandonEngineSession(startSession());
    const afterAbandoned = performCurrent(abandoned);
    expect(afterAbandoned.accepted).toBe(false);
    expect(afterAbandoned.snapshot).toBe(abandoned);
  });
});

describe('错误操作、提示与帮助', () => {
  it('目标或动作不匹配都不跳步，并累计总错误和连续错误', () => {
    const initial = startSession();
    const step = getCurrentStep(HOSPITAL_TASK, initial);
    const wrongTarget = performEngineAction(HOSPITAL_TASK, initial, 'other-target', 'click', NOW);
    expect(wrongTarget.accepted).toBe(false);
    expect(wrongTarget.snapshot.currentStepId).toBe(step.id);
    expect(wrongTarget.snapshot.session.errorCount).toBe(1);
    expect(wrongTarget.snapshot.consecutiveErrors).toBe(1);
    expect(wrongTarget.snapshot.session.currentHintLevel).toBe(3);
    expect(wrongTarget.feedback).toContain(step.instruction);

    const wrongAction = performEngineAction(
      HOSPITAL_TASK,
      wrongTarget.snapshot,
      step.targetElementId,
      'doubleclick',
      NOW,
    );
    expect(wrongAction.snapshot.currentStepId).toBe(step.id);
    expect(wrongAction.snapshot.session.errorCount).toBe(2);
    expect(wrongAction.snapshot.consecutiveErrors).toBe(2);
    expect(initial.session.errorCount).toBe(0);
  });

  it('连续两次错误升到 L1，正确操作只清连续错误且不擅自恢复提示级别', () => {
    let snapshot = startSession();
    const step = getCurrentStep(HOSPITAL_TASK, snapshot);
    snapshot = performEngineAction(HOSPITAL_TASK, snapshot, 'wrong-1', 'click', NOW).snapshot;
    snapshot = performEngineAction(HOSPITAL_TASK, snapshot, 'wrong-2', 'click', NOW).snapshot;
    expect(snapshot.session.currentHintLevel).toBe(1);

    const correct = performEngineAction(
      HOSPITAL_TASK,
      snapshot,
      step.targetElementId,
      step.expectedAction,
      NOW,
    );
    expect(correct.snapshot.consecutiveErrors).toBe(0);
    expect(correct.snapshot.session.errorCount).toBe(2);
    expect(correct.snapshot.session.currentHintLevel).toBe(1);
  });

  it('手动设置提示级别保持纯函数语义', () => {
    const initial = startSession();
    const changed = setEngineHintLevel(initial, 2);
    expect(changed.session.currentHintLevel).toBe(2);
    expect(initial.session.currentHintLevel).toBe(3);
    expect(changed.currentStepId).toBe(initial.currentStepId);
  });

  it.each([1, 2, 3] as const)('L%i 主动帮助按提示粒度取值，累计次数且不改变步骤或等级', (level) => {
    const initial = setEngineHintLevel(startSession(), level);
    const step = getCurrentStep(HOSPITAL_TASK, initial);
    const helped = requestEngineHelp(HOSPITAL_TASK, initial);
    expect(helped.accepted).toBe(true);
    expect(helped.feedback).toBe(step.hints[level === 1 ? 0 : 1]);
    expect(helped.snapshot.session.helpCount).toBe(1);
    expect(helped.snapshot.session.currentHintLevel).toBe(level);
    expect(helped.snapshot.currentStepId).toBe(step.id);
    expect(initial.session.helpCount).toBe(0);
  });
  it('缺少第二级提示时使用 instruction，非法提示档位或已退出会话不改变状态', () => {
    const initial = startSession();
    const task = { ...HOSPITAL_TASK, steps: HOSPITAL_TASK.steps.map(step => ({ ...step, hints: [] })) };
    expect(requestEngineHelp(task, initial).feedback).toBe(task.steps[0]?.instruction);
    expect(setEngineHintLevel(initial, 4 as 3)).toBe(initial);
    expect(setEngineHintLevel(initial, NaN as 3)).toBe(initial);
    const abandoned = abandonEngineSession(initial);
    expect(setEngineHintLevel(abandoned, 1)).toBe(abandoned);
  });

  it('已完成会话请求帮助不增加计数', () => {
    const completed = completeHospital();
    const helped = requestEngineHelp(HOSPITAL_TASK, completed);
    expect(helped.accepted).toBe(false);
    expect(helped.snapshot.session.helpCount).toBe(0);
  });
});

describe('返回、重启与退出', () => {
  it('active 会话可回前一步，首步保持不动并说明', () => {
    const initial = startSession();
    const atFirst = goBackEngineStep(HOSPITAL_TASK, initial);
    expect(atFirst.accepted).toBe(false);
    expect(atFirst.snapshot).toBe(initial);
    expect(atFirst.feedback).toContain('第一步');

    const second = performCurrent(initial).snapshot;
    const back = goBackEngineStep(HOSPITAL_TASK, second);
    expect(back.accepted).toBe(true);
    expect(back.snapshot.currentStepId).toBe(HOSPITAL_TASK.steps[0]?.id);
    expect(second.currentStepId).toBe(HOSPITAL_TASK.steps[1]?.id);
  });

  it('完成状态不能返回上一步', () => {
    const completed = completeHospital();
    const back = goBackEngineStep(HOSPITAL_TASK, completed);
    expect(back.accepted).toBe(false);
    expect(back.completed).toBe(true);
    expect(back.snapshot).toBe(completed);
  });

  it('重启生成全新 active 记录并清空进度和计数', () => {
    const previous = completeHospital();
    const restarted = restartEngineSession(HOSPITAL_TASK, previous, {
      id: 'session-new',
      now: '2026-11-05T09:00:00.000Z',
      hintLevel: 2,
    });
    expect(restarted.session.id).toBe('session-new');
    expect(restarted.session.startedAt).toBe('2026-11-05T09:00:00.000Z');
    expect(restarted.session.status).toBe('active');
    expect(restarted.session.completedAt).toBeNull();
    expect(restarted.session.errorCount).toBe(0);
    expect(restarted.session.helpCount).toBe(0);
    expect(restarted.session.currentHintLevel).toBe(2);
    expect(restarted.currentStepId).toBe(HOSPITAL_TASK.steps[0]?.id);
    expect(previous.session.status).toBe('completed');
  });

  it('仅 active 会话可退出，其他状态保持不变', () => {
    const active = startSession();
    const abandoned = abandonEngineSession(active);
    expect(abandoned.session.status).toBe('abandoned');
    expect(active.session.status).toBe('active');
    expect(abandonEngineSession(abandoned)).toBe(abandoned);

    const completed = completeHospital();
    expect(abandonEngineSession(completed)).toBe(completed);
  });
});

describe('快照恢复与损坏数据防护', () => {
  it('可从 JSON 迁移恢复合法 active 快照，并解除对象引用', () => {
    const original = performCurrent(startSession()).snapshot;
    const serialized = JSON.parse(JSON.stringify(original)) as unknown;
    const restored = restoreEngineSnapshot(HOSPITAL_TASK, serialized);
    expect(restored).toEqual(original);
    expect(restored).not.toBe(original);
    expect(restored?.session).not.toBe(original.session);
  });

  it('允许恢复合法 completed 与 abandoned 快照', () => {
    const completed = completeHospital();
    expect(restoreEngineSnapshot(HOSPITAL_TASK, completed)).toEqual(completed);
    const abandoned = abandonEngineSession(startSession());
    expect(restoreEngineSnapshot(HOSPITAL_TASK, abandoned)).toEqual(abandoned);
  });

  it('恢复无版本旧快照并允许同一 schema 的新增可选字段', () => {
    const valid = startSession();
    const legacy = { session: { ...valid.session, optionalField: 'new' }, currentStepId: valid.currentStepId, consecutiveErrors: valid.consecutiveErrors, optionalField: true };
    expect(restoreEngineSnapshot(HOSPITAL_TASK, legacy)).toEqual(valid);
    expect(restoreEngineSnapshot(HOSPITAL_TASK, { ...legacy, schemaVersion: 0 })).toEqual(valid);
    expect(restoreEngineSnapshot(HOSPITAL_TASK, { ...legacy, schemaVersion: SNAPSHOT_SCHEMA_VERSION })).toEqual(valid);
  });

  it('拒绝非对象、缺必填字段、未知版本和任务不匹配的数据', () => {
    const valid = startSession();
    const cases: unknown[] = [
      null,
      [],
      'snapshot',
      {},
      { ...valid, schemaVersion: 99 },
      { ...valid, schemaVersion: '1' },
      { session: valid.session, currentStepId: valid.currentStepId },
      { ...valid, session: { ...valid.session, completedAt: undefined } },
      { ...valid, session: { ...valid.session, id: '' } },
      { ...valid, session: { ...valid.session, taskId: TAXI_TASK.id } },
    ];
    for (const value of cases) {
      expect(restoreEngineSnapshot(HOSPITAL_TASK, value)).toBeNull();
    }
  });

  it('拒绝伪造日期、状态、计数、提示级别和当前步骤', () => {
    const valid = performEngineAction(
      HOSPITAL_TASK,
      startSession(),
      'wrong-target',
      'click',
      NOW,
    ).snapshot;
    const cases: unknown[] = [
      { ...valid, session: { ...valid.session, startedAt: 'not-a-date' } },
      { ...valid, session: { ...valid.session, status: 'not_started' } },
      { ...valid, session: { ...valid.session, status: 'deleted' } },
      { ...valid, session: { ...valid.session, errorCount: -1 } },
      { ...valid, session: { ...valid.session, helpCount: 0.5 } },
      { ...valid, session: { ...valid.session, currentHintLevel: 4 } },
      { ...valid, currentStepId: 'injected-step' },
      { ...valid, consecutiveErrors: -1 },
      { ...valid, consecutiveErrors: 2 },
      { ...valid, session: { ...valid.session, completedAt: LATER } },
    ];
    for (const value of cases) {
      expect(restoreEngineSnapshot(HOSPITAL_TASK, value)).toBeNull();
    }
  });

  it('拒绝篡改完成状态、完成时间和完成步骤', () => {
    const completed = completeHospital();
    const active = startSession();
    const cases: unknown[] = [
      { ...completed, session: { ...completed.session, completedAt: null } },
      { ...completed, session: { ...completed.session, completedAt: 'yesterday' } },
      { ...completed, session: { ...completed.session, completedAt: '2026-11-05T07:00:00.000Z' } },
      { ...completed, currentStepId: HOSPITAL_TASK.steps[0]?.id },
      { ...completed, consecutiveErrors: 1 },
      { ...active, session: { ...active.session, status: 'completed', completedAt: LATER } },
    ];
    for (const value of cases) {
      expect(restoreEngineSnapshot(HOSPITAL_TASK, value)).toBeNull();
    }
  });
});

describe('默认提示级别纯函数', () => {
  it.each([
    [-1, undefined, 1],
    [0, undefined, 1],
    [1, undefined, 2],
    [2, undefined, 3],
    [99, undefined, 3],
    [0, 1, 1],
    [0, 2, 1],
    [0, 3, 1],
    [1, 1, 2],
    [1, 3, 3],
    [2, 1, 3],
    [2, 2, 3],
  ] as const)('完成次数 %i、偏好 %s 时返回 L%i', (count, preferred, expected) => {
    expect(getDefaultHintLevel(count, preferred)).toBe(expected);
  });
});
