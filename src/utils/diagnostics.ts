/** 本地诊断只记录固定操作名和标准异常类别，绝不输出原始 message、stack、截图或用户输入。 */
const knownErrorNames = new Set([
  'Error', 'TypeError', 'SyntaxError', 'RangeError', 'AbortError', 'TimeoutError',
  'QuotaExceededError', 'SecurityError', 'InvalidStateError', 'NotAllowedError',
  'DataCloneError', 'DataError', 'ConstraintError', 'TransactionInactiveError',
  'NetworkError', 'DatabaseClosedError', 'OpenFailedError', 'BulkError', 'UnknownError',
]);

export function warnDiagnostic(operation: string, error: unknown): void {
  const name = error instanceof Error || (typeof DOMException !== 'undefined' && error instanceof DOMException)
    ? error.name : 'UnknownError';
  console.warn('[SilverGuide]', operation, { errorType: knownErrorNames.has(name) ? name : 'UnknownError' });
}
