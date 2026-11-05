/** TRD §6.1 Task：教学任务 */
export interface Task {
  id: string;
  title: string;
  description: string;
  category: string;
  steps: TaskStep[];
  version: number;
}

/** TRD §6.2 TaskStep：任务步骤 */
export interface TaskStep {
  id: string;
  taskId: string;
  instruction: string;
  targetElementId: string;
  expectedAction: string;
  successCondition: string;
  hints: string[];
  nextStepId: string | null;
}
