import { describe, expect, it } from 'vitest';
import { createEngineSession, getCurrentStep, performEngineAction } from '@/engine/taskEngine';
import type { Task } from '@/types/task';
import { DEMO_TASKS, getTaskById, HOSPITAL_TASK, TAXI_TASK } from '@/tasks/demoData';

const START = '2026-11-05T10:00:00.000Z';
const FINISH = '2026-11-05T10:10:00.000Z';

function expectCompletePath(task: Task): void {
  let snapshot = createEngineSession(task, { id: `${task.id}-session`, now: START, hintLevel: 1 });

  for (const [index, step] of task.steps.entries()) {
    expect(snapshot.currentStepId).toBe(step.id);
    expect(getCurrentStep(task, snapshot)).toBe(step);
    const action = performEngineAction(
      task,
      snapshot,
      step.targetElementId,
      step.expectedAction,
      FINISH,
    );
    expect(action.accepted).toBe(true);
    expect(action.completed).toBe(index === task.steps.length - 1);
    snapshot = action.snapshot;
  }

  expect(snapshot.session.status).toBe('completed');
  expect(snapshot.session.completedAt).toBe(FINISH);
  expect(snapshot.session.errorCount).toBe(0);
  expect(snapshot.consecutiveErrors).toBe(0);
}

describe('两套演示任务配置', () => {
  it('导出固定任务并能按 ID 查询', () => {
    expect(DEMO_TASKS).toEqual([HOSPITAL_TASK, TAXI_TASK]);
    expect(getTaskById('hospital-registration')).toBe(HOSPITAL_TASK);
    expect(getTaskById('taxi-ride')).toBe(TAXI_TASK);
    expect(getTaskById('unknown')).toBeUndefined();
  });

  it.each(DEMO_TASKS.map((task) => [task.id, task] as const))(
    '%s 含六个严格串联、目标唯一的 click 步骤',
    (_id, task) => {
      expect(task.version).toBe(1);
      expect(task.steps).toHaveLength(6);
      expect(new Set(task.steps.map((step) => step.id)).size).toBe(6);
      expect(new Set(task.steps.map((step) => step.targetElementId)).size).toBe(6);

      for (const [index, step] of task.steps.entries()) {
        expect(step.taskId).toBe(task.id);
        expect(step.expectedAction).toBe('click');
        expect(step.targetElementId.length).toBeGreaterThan(0);
        expect(step.successCondition.length).toBeGreaterThan(0);
        expect(step.instruction.length).toBeGreaterThan(0);
        expect(step.hints.length).toBeGreaterThanOrEqual(2);
        expect(step.hints.every((hint) => hint.length > 0)).toBe(true);
        expect(step.nextStepId).toBe(task.steps[index + 1]?.id ?? null);
      }
    },
  );

  it('医院任务严格对应进入、预约、科室、时段、确认、结果流程', () => {
    expect(HOSPITAL_TASK.steps.map((step) => step.targetElementId)).toEqual([
      'hospital-home-entry',
      'hospital-registration-button',
      'hospital-department-general',
      'hospital-timeslot-monday-morning',
      'hospital-confirm-button',
      'hospital-result-button',
    ]);
    expect(HOSPITAL_TASK.description).toContain('不产生真实医疗预约');
  });

  it('打车任务严格对应首页、目的地、车型、费用、确认、结果流程', () => {
    expect(TAXI_TASK.steps.map((step) => step.targetElementId)).toEqual([
      'taxi-home-entry',
      'taxi-destination-park',
      'taxi-car-comfort',
      'taxi-fare-button',
      'taxi-confirm-button',
      'taxi-result-button',
    ]);
    expect(TAXI_TASK.description).toContain('不生成真实订单或支付行为');
  });
});

describe('演示任务全路径', () => {
  it('医院挂号六步全部正确后完成', () => {
    expectCompletePath(HOSPITAL_TASK);
  });

  it('手机打车六步全部正确后完成', () => {
    expectCompletePath(TAXI_TASK);
  });
});
