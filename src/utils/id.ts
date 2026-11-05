/** 生成本地记录 ID；不依赖网络，也不包含任何个人信息。 */
export function createId(prefix: string): string {
  const globalCrypto: Crypto | undefined = globalThis.crypto;
  const unique =
    globalCrypto && typeof globalCrypto.randomUUID === 'function'
      ? globalCrypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${unique}`;
}
