import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { Pinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TrainingView from '@/views/TrainingView.vue';
import ProgressView from '@/views/ProgressView.vue';
import { DEMO_TASKS, getTaskById } from '@/tasks';
import { usePracticeStore } from '@/stores/practice';
import { useSettingsStore } from '@/stores/settings';
import { progressRepository } from '@/repositories/progressRepository';

const routerPush = vi.hoisted(() => vi.fn());

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
}));

let pinia: Pinia;

async function mountTraining(taskId: string) {
  const wrapper = mount(TrainingView, {
    props: { taskId },
    global: { plugins: [pinia] },
  });
  const firstTarget = getTaskById(taskId)?.steps[0]?.targetElementId;
  await vi.waitFor(() => {
    const store = usePracticeStore();
    expect(store.loading).toBe(false);
    expect(wrapper.find(`#${firstTarget}`).exists()).toBe(true);
  });
  return wrapper;
}

async function completeCurrentTask(taskId: string) {
  const task = getTaskById(taskId);
  if (!task) throw new Error('测试任务不存在');
  const wrapper = await mountTraining(taskId);
  const store = usePracticeStore();
  for (const step of task.steps) {
    const target = wrapper.find(`#${step.targetElementId}`);
    expect(target.exists(), `应显示目标 ${step.targetElementId}`).toBe(true);
    expect(wrapper.text()).toContain(step.instruction);
    await target.trigger('click');
    await flushPromises();
  }
  expect(store.snapshot?.session.status).toBe('completed');
  expect(wrapper.get('[data-testid="practice-result"]').text()).toContain('本次练习完成');
  // DOM 点击立即推进会话，真正持久化由串行队列完成；档案读取是明确的提交屏障。
  await store.loadRecords();
  return { wrapper, store };
}

beforeEach(async () => {
  vi.useRealTimers();
  window.localStorage.clear();
  routerPush.mockReset();
  await progressRepository.clear();
  pinia = createPinia();
  setActivePinia(pinia);
});

afterEach(async () => {
  // 防止上个用例尚未提交的 IndexedDB 写入越过下个用例的数据库清理。
  await usePracticeStore(pinia).loadRecords();
});

describe('M1 完整训练路径与进度状态', () => {
  it('即使用户偏好独立练习，首次接触新任务仍默认 L1', async () => {
    const store = usePracticeStore();
    const settings = useSettingsStore();
    settings.setPreferredHintLevel(3);
    await store.loadTask('hospital-registration');
    expect(store.snapshot?.session.currentHintLevel).toBe(1);
  });

  it.each(DEMO_TASKS.map((task) => task.id))('%s 可从首页目标开始走完六步并保存结果', async (taskId) => {
    const { store, wrapper } = await completeCurrentTask(taskId);
    expect(store.snapshot?.session.errorCount).toBe(0);
    expect(store.snapshot?.session.completedAt).not.toBeNull();
    expect(store.snapshot?.session.currentHintLevel).toBe(1);
    expect(wrapper.text()).toContain(taskId === 'hospital-registration' ? '模拟预约成功' : '模拟叫车成功');

    const records = await progressRepository.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.snapshot?.session.status).toBe('completed');

    mount(ProgressView, { global: { plugins: [pinia] } });
    await flushPromises();
    expect(store.records).toHaveLength(1);
  });

  it('错误操作不跳步，连续两次错误恢复 L1，并保存错误统计', async () => {
    const wrapper = await mountTraining('hospital-registration');
    const store = usePracticeStore();
    await store.setHintLevel(3);
    await wrapper.find('#hospital-home-entry').trigger('click');
    await flushPromises();

    await wrapper.find('#hospital-reports').trigger('click');
    await flushPromises();
    expect(store.snapshot?.currentStepId).toBe('hospital-open-registration');
    expect(store.snapshot?.session.errorCount).toBe(1);
    expect(store.snapshot?.session.currentHintLevel).toBe(3);

    await wrapper.find('#hospital-reports').trigger('click');
    await flushPromises();
    expect(store.snapshot?.currentStepId).toBe('hospital-open-registration');
    expect(store.snapshot?.session.errorCount).toBe(2);
    expect(store.snapshot?.session.currentHintLevel).toBe(1);
    expect(wrapper.get('[data-testid="action-feedback"]').text()).toContain('预约挂号');
    expect(wrapper.find('#hospital-registration-button').classes()).toContain('ring-4');
  });

  it('帮助、返回、手动提示、重新开始和退出均有确定性结果', async () => {
    await mountTraining('taxi-ride');
    const store = usePracticeStore();
    const firstId = store.snapshot?.session.id;

    await store.requestHelp();
    expect(store.snapshot?.session.helpCount).toBe(1);
    expect(store.helpVisible).toBe(true);

    await store.activate('taxi-home-entry');
    await store.goBack();
    expect(store.snapshot?.currentStepId).toBe('taxi-enter-home');
    await store.setHintLevel(2);
    expect(store.snapshot?.session.currentHintLevel).toBe(2);

    await store.restart();
    expect(store.snapshot?.session.id).not.toBe(firstId);
    expect(store.snapshot?.session.status).toBe('active');
    expect(await progressRepository.list()).toHaveLength(2);

    await store.abandon();
    expect(store.snapshot?.session.status).toBe('abandoned');
  });

  it('刷新后恢复未完成步骤与统计，完成后再次练习降低提示等级', async () => {
    const firstStore = usePracticeStore();
    await firstStore.loadTask('hospital-registration');
    const sessionId = firstStore.snapshot?.session.id;
    await firstStore.activate('hospital-home-entry');
    await firstStore.requestHelp();

    const secondPinia = createPinia();
    setActivePinia(secondPinia);
    const restored = usePracticeStore();
    await restored.loadTask('hospital-registration');
    expect(restored.snapshot?.session.id).toBe(sessionId);
    expect(restored.snapshot?.currentStepId).toBe('hospital-open-registration');
    expect(restored.snapshot?.session.helpCount).toBe(1);
    expect(restored.notice).toContain('恢复');

    for (const step of getTaskById('hospital-registration')?.steps.slice(1) ?? []) {
      await restored.activate(step.targetElementId);
    }
    expect(restored.snapshot?.session.status).toBe('completed');
    await restored.restart();
    expect(restored.snapshot?.session.currentHintLevel).toBe(2);
  });

  it('本地存储写入失败时训练仍继续，并明确提示未持久化', async () => {
    const store = usePracticeStore();
    const save = vi.spyOn(progressRepository, 'save').mockRejectedValue(new Error('QuotaExceeded'));
    await store.loadTask('hospital-registration');
    expect(store.snapshot?.session.status).toBe('active');
    expect(store.persistenceWarning).toContain('无法保存');

    await store.activate('hospital-home-entry');
    expect(store.snapshot?.currentStepId).toBe('hospital-open-registration');
    expect(store.persistenceWarning).toContain('无法保存');
    save.mockRestore();
  });

  it('清除学习档案后记录与当前训练均重置', async () => {
    await completeCurrentTask('taxi-ride');
    const store = usePracticeStore();
    expect(await store.clearRecords()).toBe(true);
    expect(store.records).toEqual([]);
    expect(store.snapshot).toBeNull();
    expect(await progressRepository.list()).toEqual([]);
  });

  it('训练路径不依赖 AI 或网络请求', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await completeCurrentTask('hospital-registration');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('训练视图路由参数快速切换时标题、组件、步骤始终使用同一最新任务', async () => {
    let resolveOld!: (value: null) => void;
    const read = vi.spyOn(progressRepository, 'getLatestActive').mockReturnValueOnce(new Promise<null>((resolve) => { resolveOld = resolve; }));
    const wrapper = mount(TrainingView, { props: { taskId: 'hospital-registration' }, global: { plugins: [pinia] } });
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    await wrapper.setProps({ taskId: 'taxi-ride' });
    await vi.waitFor(() => expect(wrapper.find('#taxi-home-entry').exists()).toBe(true));
    resolveOld(null); await flushPromises();
    expect(wrapper.get('h1').text()).toContain('模拟手机打车');
    expect(wrapper.find('#hospital-home-entry').exists()).toBe(false);
    expect(usePracticeStore().snapshot?.session.taskId).toBe('taxi-ride');
    wrapper.unmount();
  });

  it('L2、L3 的显式求助呈现简短线索，L1 才显示详细线索和高亮', async () => {
    const wrapper = await mountTraining('hospital-registration');
    const store = usePracticeStore(); const step = getTaskById('hospital-registration')!.steps[0]!;
    for (const level of [2, 3] as const) {
      await store.setHintLevel(level); await store.requestHelp(); await flushPromises();
      expect(wrapper.get('[data-testid="guidance"]').text()).toContain(step.hints[1]);
      expect(wrapper.get('[data-testid="action-feedback"]').text()).toBe(step.hints[1]);
      expect(wrapper.get('#hospital-home-entry').classes()).not.toContain('ring-4');
    }
    await store.setHintLevel(1); await store.requestHelp(); await flushPromises();
    expect(wrapper.get('[data-testid="guidance"]').text()).toContain(step.hints[0]);
    expect(wrapper.get('#hospital-home-entry').classes()).toContain('ring-4');
    wrapper.unmount();
  });

  it('学习档案页首次点击清除不删除，取消保留，确认才清除', async () => {
    await completeCurrentTask('taxi-ride');
    const wrapper = mount(ProgressView, { global: { plugins: [pinia] } });
    await vi.waitFor(() => expect(wrapper.find('[data-testid="progress-record"]').exists()).toBe(true));
    await wrapper.findAll('button').find(b => b.text() === '清除本机学习记录')?.trigger('click');
    expect(await progressRepository.list()).toHaveLength(1);
    expect(wrapper.text()).toContain('清除后无法恢复');
    await wrapper.findAll('button').find(b => b.text() === '取消，保留记录')?.trigger('click');
    expect(await progressRepository.list()).toHaveLength(1);
    await wrapper.findAll('button').find(b => b.text() === '清除本机学习记录')?.trigger('click');
    await wrapper.get('[data-testid="confirm-clear-records"]').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('学习记录已清除'));
    expect(await progressRepository.list()).toEqual([]);
    wrapper.unmount();
  });

  it('退出保存期间离开训练页面，不覆盖后续导航', async () => {
    const wrapper = await mountTraining('hospital-registration');
    let release!: () => void;
    const save = progressRepository.save.bind(progressRepository);
    const blocked = vi.spyOn(progressRepository, 'save').mockImplementationOnce(async (...args) => {
      await new Promise<void>(resolve => { release = resolve; });
      return save(...args);
    });
    await wrapper.findAll('button').find(button => button.text() === '退出练习')?.trigger('click');
    await vi.waitFor(() => expect(blocked).toHaveBeenCalled());
    wrapper.unmount();
    release();
    await usePracticeStore().loadRecords();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('不兼容档案安全展示，用户仍可清除', async () => {
    const invalid = { id: 'old-incompatible', taskId: 'hospital-registration', taskVersion: 1,
      startedAt: '', updatedAt: '', snapshot: null };
    vi.spyOn(progressRepository, 'list').mockResolvedValueOnce([invalid]);
    const wrapper = mount(ProgressView, { global: { plugins: [pinia] } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('记录不兼容'));
    expect(wrapper.text()).toContain('原始记录仍保留');
    expect(wrapper.findAll('button').some(button => button.text() === '清除本机学习记录')).toBe(true);
    wrapper.unmount();
  });
});
