// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createTrustedProxyMatcher, normalizeAddress, resolveClientAddress } from '../../server/clientAddress';

describe('可信代理与地址归一化', () => {
  it('默认及非可信直连只使用 socket 地址', () => {
    expect(resolveClientAddress('192.0.2.1', '198.51.100.1', createTrustedProxyMatcher())).toBe('192.0.2.1');
    expect(resolveClientAddress('192.0.2.1', '198.51.100.1', createTrustedProxyMatcher('127.0.0.1'))).toBe('192.0.2.1');
  });
  it('明确配置的连续代理链返回首个非代理客户端', () => {
    const trusted = createTrustedProxyMatcher('127.0.0.1, 10.10.0.0/24, 2001:db8:1::/64');
    expect(resolveClientAddress('127.0.0.1', '192.0.2.10, 10.10.0.3', trusted)).toBe('192.0.2.10');
    expect(resolveClientAddress('2001:db8:1::2', '2001:db8:2::a', trusted)).toBe('2001:db8:2::a');
  });
  it('配置或头部无效时保守使用直连地址', () => {
    expect(createTrustedProxyMatcher('127.0.0.1, invalid')( '127.0.0.1')).toBe(false);
    expect(createTrustedProxyMatcher('0.0.0.0/0')('192.0.2.1')).toBe(false);
    expect(resolveClientAddress('127.0.0.1', 'unknown', createTrustedProxyMatcher('127.0.0.1'))).toBe('127.0.0.1');
    expect(resolveClientAddress('127.0.0.1', ['192.0.2.1'], createTrustedProxyMatcher('127.0.0.1'))).toBe('127.0.0.1');
  });
  it('归一化映射地址及 IPv6 表示，使用相同限流键', () => {
    expect(normalizeAddress('::ffff:192.0.2.10')).toBe('192.0.2.10');
    expect(normalizeAddress('::ffff:c000:20a')).toBe('192.0.2.10');
    expect(normalizeAddress('2001:0DB8:0:0:0:0:0:1')).toBe('2001:db8::1');
  });
});
