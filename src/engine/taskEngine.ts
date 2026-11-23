import type { Task, TaskStep } from '@/types/task';
import type { HintLevel, PracticeSession } from '@/types/session';

/** 旧版无 schemaVersion 的快照属于 v0；仅破坏性变更才需要递增版本。 */
export const SNAPSHOT_SCHEMA_VERSION = 1 as const;

export interface TaskEngineSnapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  session: PracticeSession;
  currentStepId: string;
  consecutiveErrors: number;
}

export interface ActionResult {
  snapshot: TaskEngineSnapshot;
  accepted: boolean;
  completed: boolean;
  feedback: string;
}

export interface EngineSessionOptions {
  id: string;
  now: string;
  hintLevel: HintLevel;
}

type RestorableStatus = 'active' | 'completed' | 'abandoned';

function copySnapshot(snapshot: TaskEngineSnapshot): TaskEngineSnapshot {
  return {
    ...snapshot,
    session: { ...snapshot.session },
  };
}

function result(
  snapshot: TaskEngineSnapshot,
  accepted: boolean,
  feedback: string,
): ActionResult {
  return {
    snapshot,
    accepted,
    completed: snapshot.session.status === 'completed',
    feedback,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasRequiredKeys(value: Record<string, unknown>, expectedKeys: string[]): boolean {
  return expectedKeys.every((key) => Object.hasOwn(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  return isoPattern.test(value) && !Number.isNaN(Date.parse(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isHintLevel(value: unknown): value is HintLevel {
  return value === 1 || value === 2 || value === 3;
}

function isRestorableStatus(value: unknown): value is RestorableStatus {
  return value === 'active' || value === 'completed' || value === 'abandoned';
}

export function createEngineSession(
  task: Task,
  options: EngineSessionOptions,
): TaskEngineSnapshot {
  const firstStep = task.steps[0];
  if (!firstStep || firstStep.taskId !== task.id) {
    throw new Error('无法开始练习：任务缺少有效的第一步。');
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    session: {
      id: options.id,
      taskId: task.id,
      startedAt: options.now,
      completedAt: null,
      status: 'active',
      errorCount: 0,
      helpCount: 0,
      currentHintLevel: isHintLevel(options.hintLevel) ? options.hintLevel : 1,
    },
    currentStepId: firstStep.id,
    consecutiveErrors: 0,
  };
}

export function getCurrentStep(task: Task, snapshot: TaskEngineSnapshot): TaskStep {
  if (!snapshot || snapshot.session?.taskId !== task.id) {
    throw new Error('无法获取当前步骤：快照与任务不匹配。');
  }

  const step = task.steps.find(
    (candidate) => candidate.id === snapshot.currentStepId && candidate.taskId === task.id,
  );
  if (!step) {
    throw new Error('无法获取当前步骤：快照中的步骤不存在或不属于当前任务。');
  }
  return step;
}

export function performEngineAction(
  task: Task,
  snapshot: TaskEngineSnapshot,
  elementId: string,
  action: string,
  now: string,
): ActionResult {
  if (snapshot.session.status !== 'active') {
    const message = snapshot.session.status === 'completed'
      ? '本次练习已经完成，可以重新开始再练一次。'
      : '本次练习尚未进行或已经结束，请重新开始。';
    return result(snapshot, false, message);
  }

  const step = getCurrentStep(task, snapshot);
  const matches = step.targetElementId === elementId && step.expectedAction === action;

  if (!matches) {
    const consecutiveErrors = snapshot.consecutiveErrors + 1;
    const nextSnapshot: TaskEngineSnapshot = {
      ...snapshot,
      session: {
        ...snapshot.session,
        errorCount: snapshot.session.errorCount + 1,
        currentHintLevel: consecutiveErrors >= 2 ? 1 : snapshot.session.currentHintLevel,
      },
      consecutiveErrors,
    };
    return result(nextSnapshot, false, `没关系，我们继续这一步。${step.instruction}`);
  }

  if (step.nextStepId === null) {
    const nextSnapshot: TaskEngineSnapshot = {
      ...snapshot,
      session: {
        ...snapshot.session,
        status: 'completed',
        completedAt: now,
      },
      consecutiveErrors: 0,
    };
    return result(nextSnapshot, true, '做得很好，本次模拟练习已完成！');
  }

  const nextStep = task.steps.find(
    (candidate) => candidate.id === step.nextStepId && candidate.taskId === task.id,
  );
  if (!nextStep) {
    throw new Error('无法前进：任务的下一步配置无效。');
  }

  const nextSnapshot: TaskEngineSnapshot = {
    ...snapshot,
    session: { ...snapshot.session },
    currentStepId: nextStep.id,
    consecutiveErrors: 0,
  };
  return result(nextSnapshot, true, `做对了！下一步：${nextStep.instruction}`);
}

export function requestEngineHelp(task: Task, snapshot: TaskEngineSnapshot): ActionResult {
  if (snapshot.session.status !== 'active') {
    return result(snapshot, false, '本次练习未在进行中，无需继续请求帮助。');
  }

  const step = getCurrentStep(task, snapshot);
  const nextSnapshot = copySnapshot(snapshot);
  nextSnapshot.session.helpCount += 1;
  return result(nextSnapshot, true, getStepHint(step, snapshot.session.currentHintLevel));
}

/** L1 明确分步提示；L2/L3 求助优先使用较短的定位线索。 */
export function getStepHint(step: TaskStep, level: HintLevel): string {
  return (level === 1 ? step.hints[0] : step.hints[1]) ?? step.instruction;
}

export function setEngineHintLevel(
  snapshot: TaskEngineSnapshot,
  level: HintLevel,
): TaskEngineSnapshot {
  if (!isHintLevel(level) || snapshot.session.status !== 'active') return snapshot;
  const nextSnapshot = copySnapshot(snapshot);
  nextSnapshot.session.currentHintLevel = level;
  return nextSnapshot;
}

export function goBackEngineStep(task: Task, snapshot: TaskEngineSnapshot): ActionResult {
  if (snapshot.session.status !== 'active') {
    const message = snapshot.session.status === 'completed'
      ? '练习已完成，不能返回修改；可以重新开始练习。'
      : '当前练习不在进行中，不能返回上一步。';
    return result(snapshot, false, message);
  }

  const currentStep = getCurrentStep(task, snapshot);
  const currentIndex = task.steps.findIndex((step) => step.id === currentStep.id);
  const previousStep = currentIndex > 0 ? task.steps[currentIndex - 1] : undefined;
  if (!previousStep) {
    return result(snapshot, false, '现在已经是第一步，从这里继续就好。');
  }

  return result(
    { ...snapshot, session: { ...snapshot.session }, currentStepId: previousStep.id },
    true,
    `已返回上一步。${previousStep.instruction}`,
  );
}

export function restartEngineSession(
  task: Task,
  _snapshot: TaskEngineSnapshot,
  options: EngineSessionOptions,
): TaskEngineSnapshot {
  return createEngineSession(task, options);
}

export function abandonEngineSession(snapshot: TaskEngineSnapshot): TaskEngineSnapshot {
  if (snapshot.session.status !== 'active') return snapshot;
  const nextSnapshot = copySnapshot(snapshot);
  nextSnapshot.session.status = 'abandoned';
  return nextSnapshot;
}

export function restoreEngineSnapshot(
  task: Task,
  value: unknown,
): TaskEngineSnapshot | null {
  if (!isRecord(value) || !hasRequiredKeys(value, ['session', 'currentStepId', 'consecutiveErrors'])) {
    return null;
  }
  // v0（无版本字段/显式 0）与 v1 的核心字段一致，可以安全迁移；
  // 已知 schema 允许新增可选字段，未知破坏性版本不猜测、不覆盖原记录。
  const schemaVersion = Object.hasOwn(value, 'schemaVersion') ? value.schemaVersion : 0;
  if (schemaVersion !== 0 && schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return null;
  if (!isRecord(value.session) || !hasRequiredKeys(value.session, [
    'id',
    'taskId',
    'startedAt',
    'completedAt',
    'status',
    'errorCount',
    'helpCount',
    'currentHintLevel',
  ])) {
    return null;
  }

  const session = value.session;
  if (!isNonEmptyString(session.id) || session.taskId !== task.id) return null;
  if (!isIsoDateTime(session.startedAt)) return null;
  if (!isRestorableStatus(session.status)) return null;
  if (!isNonNegativeInteger(session.errorCount) || !isNonNegativeInteger(session.helpCount)) {
    return null;
  }
  if (!isHintLevel(session.currentHintLevel)) return null;
  if (!isNonNegativeInteger(value.consecutiveErrors)) return null;
  if (value.consecutiveErrors > session.errorCount) return null;
  if (typeof value.currentStepId !== 'string') return null;

  const currentStepIndex = task.steps.findIndex(
    (step) => step.id === value.currentStepId && step.taskId === task.id,
  );
  if (currentStepIndex < 0) return null;

  if (session.status === 'completed') {
    if (!isIsoDateTime(session.completedAt)) return null;
    if (Date.parse(session.completedAt) < Date.parse(session.startedAt)) return null;
    if (currentStepIndex !== task.steps.length - 1 || value.consecutiveErrors !== 0) return null;
  } else if (session.completedAt !== null) {
    return null;
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    session: {
      id: session.id,
      taskId: task.id,
      startedAt: session.startedAt,
      completedAt: session.completedAt as string | null,
      status: session.status,
      errorCount: session.errorCount,
      helpCount: session.helpCount,
      currentHintLevel: session.currentHintLevel,
    },
    currentStepId: value.currentStepId,
    consecutiveErrors: value.consecutiveErrors,
  };
}

export function getDefaultHintLevel(
  completedCount: number,
  preferred?: HintLevel,
): HintLevel {
  if (completedCount < 1) return 1;
  const defaultLevel: HintLevel = completedCount >= 2 ? 3 : 2;
  const preferredLevel: HintLevel = preferred === 2 || preferred === 3 ? preferred : 1;
  return Math.max(defaultLevel, preferredLevel) as HintLevel;
}
