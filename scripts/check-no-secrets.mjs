import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSource } from './secret-scan-rules.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FRONTEND_TARGETS = ['index.html', 'src', 'public', 'dist'];
const BACKEND_TARGETS = ['server', 'scripts', 'build', 'vite.config.ts', 'vite.server.config.ts', 'dist-server'];
const SCANNABLE = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.html', '.css', '.json', '.map', '.ps1', '.sh', '.cmd', '.bat', '.yaml', '.yml', '.webmanifest',
]);

const findings = [];
const scanned = { frontend: 0, backend: 0 };

function walk(target, frontend) {
  const absolute = join(ROOT, target);
  if (!existsSync(absolute)) return;
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) {
    if (SCANNABLE.has(extname(absolute))) scanFile(absolute, frontend);
    return;
  }
  for (const entry of readdirSync(absolute)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    walk(join(target, entry), frontend);
  }
}

function scanFile(absolute, frontend) {
  const content = readFileSync(absolute, 'utf8');
  scanned[frontend ? 'frontend' : 'backend']++;
  for (const finding of inspectSource(absolute, content, frontend)) findings.push(`${relative(ROOT, absolute)}:${finding.line} — ${finding.label}`);
}

for (const target of FRONTEND_TARGETS) walk(target, true);
for (const target of BACKEND_TARGETS) walk(target, false);

// 本地 .env 只允许占位值；真正的凭证应配置在 Qoder Sites 服务端 Secrets
for (const name of ['.env', '.env.local', '.env.development', '.env.development.local', '.env.staging', '.env.staging.local', '.env.production', '.env.production.local', '.env.test', '.env.test.local']) {
  const absolute = join(ROOT, name);
  if (!existsSync(absolute)) continue;
  readFileSync(absolute, 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) return;
      const [, key, rawValue] = match;
      const value = rawValue.trim().replace(/^["']|["']$/g, '');
      const isSecretKey = /TOKEN|SECRET|PASSWORD|_PAT\b|API_KEY/i.test(key);
      const isPlaceholder = value === '' || /^<.*>$/.test(value) || /^your[_-]/i.test(value);
      if (isSecretKey && !isPlaceholder) {
        findings.push(`${name}:${index + 1} — 本地环境文件中存在非空凭证值：${key}`);
      }
    });
}

const distIndex = join(ROOT, 'dist', 'index.html');
if (existsSync(join(ROOT, 'dist')) && !existsSync(distIndex)) {
  findings.push('dist/ 存在但缺少 index.html，构建产物不完整');
}

if (findings.length > 0) {
  console.error(`凭证与产物检查未通过，共 ${findings.length} 处：`);
  for (const item of findings) console.error(`  - ${item}`);
  process.exit(1);
}

console.log(
  `凭证与产物检查通过：扫描 ${scanned.frontend} 个前端文件、${scanned.backend} 个服务端/脚本文件，未发现私密凭证；` +
    `${existsSync(distIndex) ? 'dist/index.html 存在' : '尚未构建（dist 不存在）'}。`,
);
