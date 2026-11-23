import { createQoderVisionProvider } from './qoderVisionProvider';

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/** 只在服务端读取配置；错误配置降级为未接入，避免影响离线训练。 */
export function readVisionConfig(env: Record<string, string | undefined> = process.env) {
  const token = env.QODER_ACCESS_TOKEN?.trim();
  const agentId = env.QODER_VISION_AGENT_ID?.trim();
  const environmentId = env.QODER_VISION_ENVIRONMENT_ID?.trim();
  let provider = null;
  try {
    if (token && agentId && environmentId) {
      const base = new URL(env.QODER_API_BASE_URL?.trim() || 'https://api.qoder.com.cn/api/v1/cloud');
      if (base.protocol === 'https:' && !base.username && !base.password && !base.search && !base.hash) {
        provider = createQoderVisionProvider({ token, agentId, environmentId, baseUrl: base.href });
      }
    }
  } catch { /* 配置错误时仅禁用 AI */ }
  const dailyLimit = boundedInteger(env.SILVERGUIDE_DAILY_AI_LIMIT, 50, 1, 500);
  let publicOrigin: string | undefined;
  try {
    if (env.SILVERGUIDE_PUBLIC_ORIGIN) {
      const parsed = new URL(env.SILVERGUIDE_PUBLIC_ORIGIN);
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) publicOrigin = parsed.origin;
    }
  } catch { /* 仅接受完整合法的公开 HTTPS 源 */ }
  return {
    provider, dailyLimit, publicOrigin,
    trustedProxyCidrs: env.SILVERGUIDE_TRUSTED_PROXY_CIDRS?.trim(),
    perIpPerMinute: boundedInteger(env.SILVERGUIDE_VISION_PER_IP_PER_MINUTE, 4, 1, 120),
    globalPerMinute: boundedInteger(env.SILVERGUIDE_VISION_GLOBAL_PER_MINUTE, 60, 1, 1000),
    maxConcurrent: boundedInteger(env.SILVERGUIDE_VISION_MAX_CONCURRENT, 4, 1, 16),
    maxConcurrentPerIp: boundedInteger(env.SILVERGUIDE_VISION_MAX_CONCURRENT_PER_IP, 1, 1, 16),
    dailyPerIpLimit: boundedInteger(env.SILVERGUIDE_DAILY_AI_PER_IP_LIMIT, 20, 1, 500),
    bodyTimeoutMs: boundedInteger(env.SILVERGUIDE_VISION_BODY_TIMEOUT_MS, 15_000, 1000, 30_000),
  };
}
