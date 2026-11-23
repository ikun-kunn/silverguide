import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectSource } from '../../scripts/secret-scan-rules.mjs';

test('服务端允许从环境读取和动态认证，前端仍禁止认证头', () => {
  const source = 'const token = process.env.QODER_ACCESS_TOKEN?.trim() ?? ""; const headers = { Authorization: `Bearer ${token}` };';
  assert.deepEqual(inspectSource('server/provider.ts', source, false), []);
  assert.ok(inspectSource('src/client.ts', source, true).length > 0);
});

test('服务端拒绝静态凭证、属性字面量和默认回退值', () => {
  for (const source of ['const token = "synthetic-literal";', 'const config = { apiKey: "synthetic-literal" };', 'const token = process.env.QODER_ACCESS_TOKEN ?? "synthetic-literal";', 'const headers = { Authorization: "synthetic-auth-value" };', 'const API_KEY = "synthetic-literal";']) {
    const findings = inspectSource('server/demo.ts', source, false);
    assert.ok(findings.some(item => item.label.includes('硬编码')));
    assert.ok(!JSON.stringify(findings).includes('synthetic-literal'));
  }
});

test('服务端脚本中的高可信密钥特征和非空敏感赋值也会触发', () => {
  const synthetic = 'pat_' + 'x'.repeat(25);
  assert.ok(inspectSource('scripts/demo.mjs', `const value = "${synthetic}";`, false).some(x => x.label === '疑似私密密钥'));
  assert.ok(inspectSource('scripts/demo.ps1', '$QODER_ACCESS_TOKEN = "synthetic-literal"', false).length > 0);
});
