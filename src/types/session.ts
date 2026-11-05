/** TRD §6.3 PracticeSession：练习记录 */
export type SessionStatus = 'not_started' | 'active' | 'completed' | 'abandoned';

/** TRD §3.4：L1 完整 / L2 简化 / L3 独立 */
export type HintLevel = 1 | 2 | 3;

export interface PracticeSession {
  id: string;
  taskId: string;
  /** ISO 日期时间 */
  startedAt: string;
  /** ISO 日期时间或 null */
  completedAt: string | null;
  status: SessionStatus;
  errorCount: number;
  helpCount: number;
  currentHintLevel: HintLevel;
}
