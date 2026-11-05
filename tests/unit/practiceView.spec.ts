import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PracticeView from '@/views/PracticeView.vue';
import { progressRepository } from '@/repositories/progressRepository';
import { usePracticeStore } from '@/stores/practice';

const routerPush = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({ useRouter: () => ({ push: routerPush }) }));

beforeEach(async () => {
  setActivePinia(createPinia());
  routerPush.mockReset();
  await progressRepository.clear();
});

describe('M1 训练中心', () => {
  it('展示医院挂号和打车两类训练，并可进入对应路由', async () => {
    const wrapper = mount(PracticeView);
    await flushPromises();
    expect(wrapper.text()).toContain('模拟医院预约挂号');
    expect(wrapper.text()).toContain('模拟手机打车');
    expect(wrapper.findAll('[data-testid="task-status"]')).toHaveLength(2);

    const startButtons = wrapper.findAll('button').filter((button) => button.text().includes('开始模拟练习'));
    await startButtons[0]?.trigger('click');
    await startButtons[1]?.trigger('click');
    expect(routerPush).toHaveBeenCalledWith('/practice/hospital-registration');
    expect(routerPush).toHaveBeenCalledWith('/practice/taxi-ride');
  });

  it('存在未完成记录时显示继续练习', async () => {
    const practice = usePracticeStore();
    await practice.loadTask('hospital-registration');
    const wrapper = mount(PracticeView);
    await flushPromises();
    expect(wrapper.text()).toContain('上次练习可继续');
    expect(wrapper.text()).toContain('继续练习');
  });
});
