import { test, expect } from '@playwright/test';

const hospitalSteps = ['hospital-home-entry', 'hospital-registration-button', 'hospital-department-general', 'hospital-timeslot-monday-morning', 'hospital-confirm-button', 'hospital-result-button'];
const taxiSteps = ['taxi-home-entry', 'taxi-destination-park', 'taxi-car-comfort', 'taxi-fare-button', 'taxi-confirm-button', 'taxi-result-button'];

async function complete(page, title, steps) {
  await page.goto('/');
  await page.getByTestId('start-learning').click();
  await page.getByRole('region', { name: title }).getByRole('button', { name: /开始模拟练习/ }).click();
  for (const step of steps) await page.locator(`#${step}`).click();
  await expect(page.getByTestId('practice-result')).toContainText('本次练习完成');
  await page.getByRole('button', { name: '查看学习档案' }).click();
  await expect(page).toHaveURL(/\/progress$/);
}

test('A: 从首页完成模拟挂号', async ({ page }) => {
  await complete(page, '模拟医院预约挂号', hospitalSteps);
});
test('B: 从首页完成模拟叫车', async ({ page }) => {
  await complete(page, '模拟手机打车', taxiSteps);
});
test('C: 上传演示截图、同意分析并展示标注（Mock 上游，仅验证页面链路）', async ({ page }) => {
  await page.goto('/practice/hospital-registration');
  await expect(page.locator('#hospital-home-entry')).toBeVisible();
  const screenshot = await page.screenshot();
  await page.route('**/api/vision/analyze', (route) => route.fulfill({ json: { success: true, pageSummary: '医院模拟页面', instruction: '点击进入医院首页。', targetLabel: '进入医院首页', boundingBox: [0.1, 0.2, 0.5, 0.4], confidence: 0.9, safetyWarning: null, errorCode: null } }));
  await page.goto('/ai-helper');
  await page.getByTestId('screenshot-input').setInputFiles({ name: 'demo.png', mimeType: 'image/png', buffer: screenshot });
  await expect(page.getByTestId('analyze')).toBeDisabled();
  await page.getByTestId('privacy-consent').check();
  await page.getByTestId('analyze').click();
  await expect(page.getByTestId('ai-result')).toContainText('点击进入医院首页');
  await expect(page.getByTestId('annotation')).toBeVisible();
  await page.getByRole('button', { name: '隐藏标注' }).click();
  await expect(page.getByTestId('annotation')).toHaveCount(0);
});
test('D: AI 故障不影响模拟训练（Mock 503）', async ({ page }) => {
  await page.goto('/');
  const screenshot = await page.screenshot();
  await page.route('**/api/vision/analyze', (route) => route.fulfill({ status: 503 }));
  await page.goto('/ai-helper');
  await page.getByTestId('screenshot-input').setInputFiles({ name: 'demo.png', mimeType: 'image/png', buffer: screenshot });
  await page.getByTestId('privacy-consent').check();
  await page.getByTestId('analyze').click();
  await expect(page.getByTestId('ai-result')).toContainText('AI 服务暂不可用');
  await page.getByRole('link', { name: '返回模拟训练' }).click();
  await page.getByRole('region', { name: '模拟手机打车' }).getByRole('button', { name: /开始模拟练习/ }).click();
  for (const step of taxiSteps) await page.locator(`#${step}`).click();
  await expect(page.getByTestId('practice-result')).toBeVisible();
});
test('E: PWA 首次联网准备后断网重新打开，完成模拟训练', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByTestId('pwa-ready')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('offline-notice')).toContainText('当前没有网络');
  await page.getByTestId('start-learning').click();
  await page.getByRole('region', { name: '模拟手机打车' }).getByRole('button', { name: /开始模拟练习/ }).click();
  for (const step of taxiSteps) await page.locator(`#${step}`).click();
  await expect(page.getByTestId('practice-result')).toBeVisible();
  await page.goto('/ai-helper');
  await expect(page.getByTestId('analyze')).toBeDisabled();
  await context.setOffline(false);
});
test('F: 大字体、高对比度及 360px 视口不出现横向溢出', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: '特大' }).click();
  await page.getByRole('switch').first().click();
  await expect(page.locator('html')).toHaveAttribute('data-high-contrast', 'true');
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return { color: style.outlineColor, width: style.outlineWidth, style: style.outlineStyle };
  });
  expect(focus.color).toBe('rgb(0, 0, 0)');
  expect(parseFloat(focus.width)).toBeGreaterThanOrEqual(4);
  expect(focus.style).toBe('solid');
  const width = await page.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth, root: document.documentElement.scrollWidth }));
  expect(Math.max(width.body, width.root)).toBeLessThanOrEqual(width.viewport + 1);
});

test('G: 在另一个标签页清除学习档案，旧练习失效且不会恢复旧记录', async ({ page, context }) => {
  await page.goto('/practice/hospital-registration');
  await page.locator('#hospital-home-entry').click();
  const second = await context.newPage();
  try {
    await second.goto('/progress');
    await expect(second.getByTestId('progress-record')).toBeVisible();
    await second.getByRole('button', { name: '清除本机学习记录' }).click();
    await second.getByTestId('confirm-clear-records').click();
    await expect(second.getByText('学习记录已清除，显示与声音偏好保持不变。')).toBeVisible();
    await expect(page.getByText('其他页面已清除学习记录。请重新开始练习。')).toBeVisible();
    await expect(page.locator('#hospital-registration-button')).toHaveCount(0);
    await second.reload();
    await expect(second.getByTestId('progress-record')).toHaveCount(0);
    await page.getByRole('button', { name: '重新开始练习' }).click();
    await expect(page.locator('#hospital-home-entry')).toBeVisible();
  } finally { await second.close(); }
});

test('H: 敏感分析结果只显示系统安全提醒（Mock 上游）', async ({ page }) => {
  await page.goto('/practice/hospital-registration');
  await expect(page.locator('#hospital-home-entry')).toBeVisible();
  const screenshot = await page.screenshot();
  await page.route('**/api/vision/analyze', route => route.fulfill({ json: { success: true,
    pageSummary: '付款页面', instruction: '确认付款', targetLabel: '付款', boundingBox: [0.1, 0.2, 0.5, 0.4],
    confidence: 0.9, safetyWarning: null, errorCode: null } }));
  await page.goto('/ai-helper');
  await page.getByTestId('screenshot-input').setInputFiles({ name: 'demo.png', mimeType: 'image/png', buffer: screenshot });
  await page.getByTestId('privacy-consent').check();
  await page.getByTestId('analyze').click();
  await expect(page.getByTestId('ai-result')).toContainText('安全提醒（系统保护）');
  await expect(page.getByTestId('ai-result')).not.toContainText('确认付款');
  await expect(page.getByTestId('annotation')).toHaveCount(0);
});
