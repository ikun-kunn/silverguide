import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TARGETS = ['index.html', 'src', 'dist'];
const SCANNABLE = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.html', '.css', '.json', '.map',
]);

/** TRD §8.2 / NFR-007：前端源码与构建产物都不得出现私密凭证 */
const RULES = [
  { label: 'Bearer 明文令牌', pattern: /Bearer\s+[A-Za-z0-9._-]{16,}/ },
  { label: '疑似私密密钥', pattern: /\b(?:sk-|pat_|sat_|ghp_|gho_)[A-Za-z0-9_-]{20,}/i },
  { label: 'Authorization 请求头', pattern: /["']?Authorization["']?\s*:/ },
  { label: 'Cloud Agents 私有域名出现在前端', pattern: /api\.qoder\.com\.cn/ },
  { label: '服务端凭证变量名出现在前端', pattern: /QODER_ACCESS_TOKEN/ },
];

const findings = [];
const scanned = [];

function walk(target) {
  const absolute = join(ROOT, target);
  if (!existsSync(absolute)) return;
  const stat = statSync(absolute);
  if (stat.isFile()) {
    if (SCANNABLE.has(extname(absolute))) scanFile(absolute);
    return;
  }
  for (const entry of readdirSync(absolute)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    walk(join(target, entry));
  }
}

function scanFile(absolute) {
  const content = readFileSync(absolute, 'utf8');
  scanned.push(relative(ROOT, absolute));
  content.split(/\r?\n/).forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push(`${relative(ROOT, absolute)}:${index + 1} — ${rule.label}`);
      }
    }
  });
}

for (const target of TARGETS) walk(target);

// 本地 .env 只允许占位值；真正的凭证应配置在 Qoder Sites 服务端 Secrets
for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
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
  `凭证与产物检查通过：扫描 ${scanned.length} 个前端文件，未发现私密凭证；` +
    `${existsSync(distIndex) ? 'dist/index.html 存在' : '尚未构建（dist 不存在）'}。`,
);
