/** 默认只核验语料；必须显式 --live 才请求本地已配置的 AI 服务并产生费用。 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { scoreVisionCase, summarizeScores } from './vision-eval-core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = join(root, 'tests', 'vision', 'fixtures');
const manifest = JSON.parse(readFileSync(join(fixtures, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.ok(Array.isArray(manifest) && manifest.length >= 20);
assert.equal(new Set(manifest.map((item) => item.id)).size, manifest.length);
for (const item of manifest) {
  assert.match(item.file, /^sg-\d{2}\.png$/);
  const image = readFileSync(join(fixtures, item.file));
  assert.equal(image.subarray(12, 16).toString(), 'IHDR');
  assert.ok(image.length > 100 && image.length < 5 * 1024 * 1024);
  assert.ok(['target', 'uncertain', 'warning'].includes(item.expected));
  if (item.expected === 'target') assert.ok(item.targetLabel && item.boundingBox?.length === 4);
}
console.log(`已核验 ${manifest.length} 张虚构、无真实个人信息的 PNG 测试图。`);
if (!process.argv.includes('--live')) {
  console.log('本次仅检查语料，未发送任何图片，也未评估真实模型。使用 --live 才会调用服务。');
  process.exit(0);
}

const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice(8)) : manifest.length;
assert.ok(Number.isInteger(limit) && limit >= 1 && limit <= manifest.length, '无效的 --limit=N');
const endpoint = new URL(process.env.SILVERGUIDE_EVAL_URL || 'http://127.0.0.1:5173/api/vision/analyze');
assert.ok((['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) && ['http:', 'https:'].includes(endpoint.protocol)) || endpoint.protocol === 'https:', '仅允许本机 HTTP 或 HTTPS 服务');
assert.ok(!endpoint.username && !endpoint.password && endpoint.pathname === '/api/vision/analyze', '请配置不含凭证的分析接口 URL');
const rows = [];
const outputDir = join(root, 'docs', 'vision-evaluation');
mkdirSync(outputDir, { recursive: true });
const reportPath = join(outputDir, `evaluation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const save = (status) => writeFileSync(reportPath, JSON.stringify({ source: 'synthetic-fixtures-real-endpoint', status, totalPlanned: limit, summary: summarizeScores(rows), rows }, null, 2));
console.log(`真实评测：最多 ${limit} 次请求（上游预算最多 ${limit * 5} Credits）。`);
let status = 'completed';
for (const [i, item] of manifest.slice(0, limit).entries()) {
  const form = new FormData();
  form.append('image', new Blob([readFileSync(join(fixtures, item.file))], { type: 'image/png' }), item.file);
  form.append('question', item.question);
  try {
    const response = await fetch(endpoint, { method: 'POST', body: form, signal: AbortSignal.timeout(95_000), redirect: 'error' });
    const result = await response.json().catch(() => null);
    const score = scoreVisionCase(item, result);
    rows.push({ ...score, httpStatus: response.status, errorCode: result?.errorCode ?? null, targetLabel: result?.targetLabel ?? null, confidence: result?.confidence ?? null, instruction: result?.instruction ?? null, safetyWarningText: result?.safetyWarning ?? null });
    console.log(`${item.id} ${item.category}: ${score.passed ? 'PASS' : 'REVIEW'}`);
    // 未配置、额度、限流或服务故障即停止，不自动反复消耗额度。
    if ([402, 404, 429, 503, 504].includes(response.status)) { status = 'stopped-on-service-error'; break; }
  } catch {
    rows.push({ ...scoreVisionCase(item, null), errorCode: 'NETWORK_OR_TIMEOUT' }); status = 'stopped-on-service-error'; break;
  }
  save('in-progress');
  if (i < limit - 1) await delay(16_000); // 遵守本地每 IP 每分钟最多 4 次的限制。
}
save(status);
console.log(`评测报告：${reportPath}`);
