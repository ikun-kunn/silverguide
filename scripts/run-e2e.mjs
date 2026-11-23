import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const requiredVersion = '1.65.1';
const require = createRequire(import.meta.url);
function hint(reason) {
  console.error(`[SilverGuide] E2E 未执行：${reason}`);
  console.error(`请先运行 npm install --save-dev --save-exact @playwright/test@${requiredVersion}`);
  console.error('然后运行 npx playwright install chromium、npm run build、npm run test:e2e。');
  process.exitCode = 1;
}

let packageFile;
try { packageFile = require.resolve('@playwright/test/package.json'); }
catch { hint('缺少 Playwright 测试依赖。'); }
if (packageFile) {
  const manifest = JSON.parse(readFileSync(packageFile, 'utf8'));
  if (manifest.version !== requiredVersion) hint(`Playwright 版本需为 ${requiredVersion}。`);
  else {
    const cli = resolve(dirname(packageFile), typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.playwright);
    const result = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], { stdio: 'inherit', shell: false });
    process.exitCode = result.status ?? 1;
  }
}
