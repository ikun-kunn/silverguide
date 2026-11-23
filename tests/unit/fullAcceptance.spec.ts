import 'fake-indexeddb/auto';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App.vue';
import { router as applicationRouter } from '@/router';
import { DEMO_TASKS, getTaskById } from '@/tasks';
import { usePracticeStore } from '@/stores/practice';
import { useSettingsStore } from '@/stores/settings';
import { progressRepository } from '@/repositories/progressRepository';
import {
  createEngineSession, goBackEngineStep, performEngineAction, requestEngineHelp,
  restoreEngineSnapshot, setEngineHintLevel,
} from '@/engine/taskEngine';
import type { HintLevel } from '@/types';

const START = '2026-11-23T08:00:00.000Z';
const END = '2026-11-23T08:05:00.000Z';

beforeEach(async () => {
  // 只操作测试进程的 fake-indexeddb 与 jsdom 本地存储，不接触真实浏览器数据。
  await progressRepository.clear();
  window.localStorage.clear();
  setActivePinia(createPinia());
});
afterEach(async () => { await progressRepository.clear(); });

async function launch(path = '/') {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({ history: createMemoryHistory(), routes: applicationRouter.options.routes });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [pinia, router] } });
  const practice = usePracticeStore(pinia);
  const settings = useSettingsStore(pinia);
  return { wrapper, router, practice, settings };
}

describe('RC.4 全应用集成验收（jsdom + 实际路由 + fake IndexedDB）', () => {
  it.each(DEMO_TASKS.map(task => [task.id] as const))('%s：首页→训练→退出页面→重新打开→完成→学习档案', async (taskId) => {
    const task = getTaskById(taskId)!;
    let app = await launch();
    try {
      await app.wrapper.get('[data-testid="start-learning"]').trigger('click');
      await vi.waitFor(() => expect(app.router.currentRoute.value.path).toBe('/practice'));
      await app.wrapper.get(`section[aria-labelledby="task-${taskId}"] button`).trigger('click');
      await vi.waitFor(() => expect(app.wrapper.find(`#${task.steps[0]!.targetElementId}`).exists()).toBe(true));
      const sessionId = app.practice.snapshot?.session.id;
      expect(sessionId).toBeTruthy();
      await app.wrapper.get(`#${task.steps[0]!.targetElementId}`).trigger('click');
      await vi.waitFor(() => expect(app.wrapper.find(`#${task.steps[1]!.targetElementId}`).exists()).toBe(true));
      expect(await app.practice.flushPendingWrites()).toBe(true);

      // 真正经过 RouterView 切换，而非仅调用 store；重建应用和 Pinia 模拟刷新。
      await app.router.push('/settings');
      await vi.waitFor(() => expect(app.wrapper.get('main h1').text()).toBe('设置'));
      app.settings.setHighContrast(true);
      app.wrapper.unmount();
      app = await launch(`/practice/${taskId}`);
      await vi.waitFor(() => expect(app.wrapper.find(`#${task.steps[1]!.targetElementId}`).exists()).toBe(true));
      expect(app.practice.snapshot?.session.id).toBe(sessionId);
      expect(app.settings.highContrast).toBe(true);

      for (const step of task.steps.slice(1)) {
        await vi.waitFor(() => expect(app.wrapper.find(`#${step.targetElementId}`).exists()).toBe(true));
        await app.wrapper.get(`#${step.targetElementId}`).trigger('click');
      }
      await vi.waitFor(() => expect(app.wrapper.get('[data-testid="practice-result"]').text()).toContain('本次练习完成'));
      expect(await app.practice.flushPendingWrites()).toBe(true);
      await app.router.push('/progress');
      await vi.waitFor(() => expect(app.wrapper.get('[data-testid="progress-record"]').text()).toContain(task.title));
      const records = await progressRepository.list();
      expect(records).toHaveLength(1);
      expect(records[0]?.snapshot?.session).toMatchObject({ id: sessionId, status: 'completed', errorCount: 0, helpCount: 0 });
    } finally { app.wrapper.unmount(); }
  });

  it('两个模拟任务各完成六次，跨新 Pinia 恢复统计与渐进式教学', async () => {
    const completedIds = new Set<string>();
    for (const task of DEMO_TASKS) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const pinia = createPinia();
        setActivePinia(pinia);
        const practice = usePracticeStore(pinia);
        await practice.loadTask(task.id);
        const id = practice.snapshot!.session.id;
        expect(completedIds.has(id)).toBe(false);
        completedIds.add(id);
        expect(practice.snapshot?.session.currentHintLevel).toBe(Math.min(3, attempt + 1));
        await practice.requestHelp();
        for (const step of task.steps) await practice.activate(step.targetElementId);
        expect(practice.isCompleted).toBe(true);
        expect(await practice.flushPendingWrites()).toBe(true);
        expect(await progressRepository.countCompleted(task.id, task.version)).toBe(attempt + 1);
        expect(await progressRepository.getLatestActive(task.id, task.version)).toBeNull();
      }
    }
    const history = await progressRepository.list();
    expect(history).toHaveLength(12);
    expect(history.every(record => record.snapshot?.session.status === 'completed' && record.snapshot.session.helpCount === 1)).toBe(true);
  });

  it('真实页面、图片处理、visionClient 与响应校验端到端衔接（仅替换浏览器解码和本地 fetch）', async () => {
    const app = await launch('/ai-helper');
    const response = { success: true, pageSummary: '医院模拟首页', instruction: '点击预约挂号', targetLabel: '预约挂号',
      boundingBox: [0.1, 0.2, 0.5, 0.4], confidence: 0.95, safetyWarning: null, errorCode: null };
    const fetchMock = vi.fn(async (_url, _options) => new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const encoded = new Blob(['synthetic-test-pixels'], { type: 'image/webp' });
    const revoke = vi.fn();
    const OriginalURL = globalThis.URL;
    vi.stubGlobal('URL', class extends OriginalURL {
      static override createObjectURL() { return 'blob:acceptance-image'; }
      static override revokeObjectURL = revoke;
    });
    vi.stubGlobal('Image', class {
      naturalWidth = 360; naturalHeight = 640;
      onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    });
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(encoded));
    try {
      const input = app.wrapper.get<HTMLInputElement>('[data-testid="screenshot-input"]');
      Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['synthetic fixture'], 'demo.png', { type: 'image/png' })] });
      await input.trigger('change');
      await vi.waitFor(() => expect(app.wrapper.find('img[alt="您选择的截图"]').exists()).toBe(true));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(app.wrapper.get('[data-testid="analyze"]').attributes()).toHaveProperty('disabled');
      await app.wrapper.get('#question').setValue('我应该点击哪里？');
      await app.wrapper.get('[data-testid="privacy-consent"]').setValue(true);
      await app.wrapper.get('[data-testid="analyze"]').trigger('click');
      await vi.waitFor(() => expect(app.wrapper.get('[data-testid="ai-result"]').text()).toContain('点击预约挂号'));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/vision/analyze');
      const form = (fetchMock.mock.calls[0]?.[1] as RequestInit).body as FormData;
      expect(form.get('question')).toBe('我应该点击哪里？');
      expect((form.get('image') as File).name).toBe('screenshot.webp');
      expect(app.wrapper.find('[data-testid="annotation"]').exists()).toBe(true);
      await app.wrapper.findAll('button').find(button => button.text() === '隐藏标注')!.trigger('click');
      expect(app.wrapper.find('[data-testid="annotation"]').exists()).toBe(false);
      await app.router.push('/practice');
      await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:acceptance-image'));
    } finally {
      app.wrapper.unmount(); context.mockRestore(); toBlob.mockRestore(); vi.unstubAllGlobals();
    }
  });

  it('应用收到断网状态后禁用分析，模拟训练继续运行且没有网络调用', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const app = await launch('/ai-helper');
    try {
      expect(app.wrapper.get('[data-testid="offline-notice"]').text()).toContain('当前没有网络');
      expect(app.wrapper.get('[data-testid="analyze"]').attributes()).toHaveProperty('disabled');
      const task = DEMO_TASKS[0]!;
      await app.router.push(`/practice/${task.id}`);
      for (const step of task.steps) {
        await vi.waitFor(() => expect(app.wrapper.find(`#${step.targetElementId}`).exists()).toBe(true));
        await app.wrapper.get(`#${step.targetElementId}`).trigger('click');
      }
      await vi.waitFor(() => expect(app.wrapper.find('[data-testid="practice-result"]').exists()).toBe(true));
      expect(await app.practice.flushPendingWrites()).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { app.wrapper.unmount(); online.mockRestore(); vi.unstubAllGlobals(); }
  });
});

describe('RC.4 状态机混合操作回归', () => {
  it.each(DEMO_TASKS.map(task => [task.id] as const))('%s：25 条可复现的 40 次混合动作序列及快照往返', (taskId) => {
    const task = getTaskById(taskId)!;
    for (let seed = 1; seed <= 25; seed++) {
      let random = seed;
      let snapshot = createEngineSession(task, { id: `acceptance-${taskId}-${seed}`, now: START, hintLevel: 1 });
      let index = 0, errors = 0, help = 0, consecutive = 0;
      let hint: HintLevel = 1;
      let completed = false;
      for (let turn = 0; turn < 40; turn++) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        const kind = random % 5;
        const old = JSON.stringify(snapshot);
        const prior = snapshot;
        if (kind === 0) {
          const step = task.steps[index]!;
          snapshot = performEngineAction(task, snapshot, step.targetElementId, step.expectedAction, END).snapshot;
          if (!completed) { consecutive = 0; if (index === task.steps.length - 1) completed = true; else index++; }
        } else if (kind === 1) {
          // 普通误操作：模拟用户点到了其他非目标控件。
          snapshot = performEngineAction(task, snapshot, 'ordinary-non-target', 'click', END).snapshot;
          if (!completed) { errors++; consecutive++; if (consecutive >= 2) hint = 1; }
        } else if (kind === 2) {
          snapshot = goBackEngineStep(task, snapshot).snapshot;
          if (!completed && index > 0) index--;
        } else if (kind === 3) {
          snapshot = requestEngineHelp(task, snapshot).snapshot;
          if (!completed) help++;
        } else {
          const selected = ((random >>> 8) % 3 + 1) as HintLevel;
          snapshot = setEngineHintLevel(snapshot, selected);
          if (!completed) hint = selected;
        }
        expect(JSON.stringify(prior)).toBe(old);
        expect(snapshot.currentStepId).toBe(task.steps[index]!.id);
        expect(snapshot.session).toMatchObject({ status: completed ? 'completed' : 'active', errorCount: errors, helpCount: help, currentHintLevel: hint });
        expect(snapshot.consecutiveErrors).toBe(consecutive);
        const restored = restoreEngineSnapshot(task, JSON.parse(JSON.stringify(snapshot)));
        expect(restored).toEqual(snapshot);
        snapshot = restored!;
      }
    }
  });
});
