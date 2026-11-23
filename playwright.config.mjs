import { defineConfig } from '@playwright/test';

// 默认使用 Playwright Chromium；离线开发环境可显式选择已安装的桌面浏览器。
const installedChannel = process.env.SILVERGUIDE_E2E_CHANNEL;
if (installedChannel && !['msedge', 'chrome'].includes(installedChannel)) throw new Error('SILVERGUIDE_E2E_CHANNEL 仅支持 msedge 或 chrome');

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:8080', headless: true, ...(installedChannel ? { channel: installedChannel } : {}) },
  projects: [
    { name: 'mobile', use: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
  ],
  webServer: { command: 'npm run start', url: 'http://127.0.0.1:8080', reuseExistingServer: false },
});
