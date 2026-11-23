import { BlockList, isIP } from 'node:net';

type AddressFamily = 'ipv4' | 'ipv6';

/** 统一 mapped IPv4 与 IPv6 表示，避免同一地址出现多个限流键。 */
export function normalizeAddress(value: string): string | null {
  const ip = value.trim();
  const family = isIP(ip);
  if (family === 4) return ip;
  if (family !== 6) return null;
  try {
    const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/i.exec(canonical);
    if (mapped) {
      const high = Number.parseInt(mapped[1], 16), low = Number.parseInt(mapped[2], 16);
      return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
    }
    return canonical;
  } catch { return null; }
}

/** 默认不信任代理。整个配置解析失败时关闭代理信任，而不是部分开放。 */
export function createTrustedProxyMatcher(spec?: string): (address: string) => boolean {
  if (!spec?.trim()) return () => false;
  const entries = spec.split(',').map(value => value.trim());
  if (entries.length > 64) return () => false;
  const list = new BlockList();
  try {
    for (const entry of entries) {
      const parts = entry.split('/');
      const address = normalizeAddress(parts[0]);
      if (!address || parts.length > 2) return () => false;
      const family: AddressFamily = isIP(address) === 4 ? 'ipv4' : 'ipv6';
      if (parts.length === 1) list.addAddress(address, family);
      else {
        const prefix = Number(parts[1]);
        if (!/^\d+$/.test(parts[1]) || !Number.isInteger(prefix) || prefix < 1 || prefix > (family === 'ipv4' ? 32 : 128)) return () => false;
        list.addSubnet(address, prefix, family);
      }
    }
  } catch { return () => false; }
  return (address) => {
    const ip = normalizeAddress(address);
    return !!ip && list.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6');
  };
}

/** 仅从可信 socket 开始，从右向左穿过连续可信代理；异常头回退到直连地址。 */
export function resolveClientAddress(remote: string | undefined, forwarded: string | string[] | undefined, trusted: (address: string) => boolean): string {
  const peer = normalizeAddress(remote ?? '') ?? 'unknown';
  if (peer === 'unknown' || !trusted(peer) || typeof forwarded !== 'string' || forwarded.length > 4096) return peer;
  const chain = forwarded.split(',');
  if (chain.length > 32) return peer;
  const addresses = chain.map(normalizeAddress);
  if (addresses.some(address => address === null)) return peer;
  for (let i = addresses.length - 1; i >= 0; i--) {
    const address = addresses[i]!;
    if (!trusted(address)) return address;
  }
  // 全链都属于代理范围时无法可靠确认终端身份。
  return peer;
}
