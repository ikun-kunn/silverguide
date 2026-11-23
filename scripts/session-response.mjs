/** 只接受可安全用作单一路径段的非空 Session ID；不记录异常响应体。 */
export function readSessionId(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return typeof payload.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(payload.id) ? payload.id : null;
}
