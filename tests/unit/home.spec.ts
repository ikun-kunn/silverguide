import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it } from 'vitest';
import HomeView from '@/views/HomeView.vue';
import { useSettingsStore } from '@/stores/settings';

function mountHome() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: HomeView },
      { path: '/practice', component: { template: '<p>训练中心</p>' } },
      { path: '/ai-helper', component: { template: '<p>AI 看图指导</p>' } },
      { path: '/about', component: { template: '<p>关于</p>' } },
    ],
  });
  const wrapper = mount(HomeView, { global: { plugins: [pinia, router] } });
  return { wrapper, router };
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.style.removeProperty('--sg-font-scale');
  delete document.documentElement.dataset.highContrast;
});

describe('M1 首页、导航与适老化设置（TRD §3.1 / §4.2）', () => {
  it('展示产品定位、两个主要操作与模拟练习声明', () => {
    const { wrapper } = mountHome();
    expect(wrapper.text()).toContain('银龄引路人');
    expect(wrapper.text()).toContain('开始学习');
    expect(wrapper.text()).toContain('AI 看图指导');
    expect(wrapper.get('[data-testid="demo-badge"]').text()).toContain('模拟练习，不产生真实订单');
  });

  it('关键功能使用文字标签，不只依靠图标', () => {
    const { wrapper } = mountHome();
    const buttons = wrapper.findAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const button of buttons) {
      expect(button.text().trim().length).toBeGreaterThan(0);
    }
  });

  it('点击开始学习进入训练中心，第二次点击即可选择任务', async () => {
    const { wrapper, router } = mountHome();
    const primary = wrapper.findAll('button').find((button) => button.text().includes('开始学习'));
    expect(primary).toBeDefined();
    await primary?.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/practice');
  });

  it('首次使用显示可跳过的简短说明，并记住选择', async () => {
    const first = mountHome();
    expect(first.wrapper.get('[data-testid="first-visit-guide"]').text()).toContain('第一次使用');
    const dismiss = first.wrapper.findAll('button').find((button) => button.text().includes('跳过说明'));
    await dismiss?.trigger('click');
    expect(first.wrapper.find('[data-testid="first-visit-guide"]').exists()).toBe(false);
    expect(window.localStorage.getItem('silverguide.onboarding.seen.m1')).toBe('1');
    expect(mountHome().wrapper.find('[data-testid="first-visit-guide"]').exists()).toBe(false);
  });

  it('AI 入口打开看图助手', async () => {
    const { wrapper, router } = mountHome();
    const aiButton = wrapper.findAll('button').find((button) => button.text().includes('AI 看图指导'));
    await aiButton?.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/ai-helper');
  });

  it('文字大小设置真实改变根字号，并可持久化', async () => {
    const { wrapper } = mountHome();
    const large = wrapper.findAll('button').find((button) => button.text().trim() === '特大');
    expect(large).toBeDefined();
    await large?.trigger('click');
    expect(document.documentElement.style.getPropertyValue('--sg-font-scale')).toBe('1.35');
    expect(useSettingsStore().fontScale).toBe(1.35);
    expect(window.localStorage.getItem('silverguide.settings.m0')).toContain('1.35');
  });

  it('语音播报开关可切换并保存偏好', async () => {
    const { wrapper } = mountHome();
    expect(wrapper.text()).toContain('朗读说明');
    const toggle = wrapper.findAll('button').find((button) => button.attributes('role') === 'switch');
    expect(toggle?.attributes('aria-checked')).toBe('true');
    await toggle?.trigger('click');
    expect(toggle?.attributes('aria-checked')).toBe('false');
    expect(useSettingsStore().voiceEnabled).toBe(false);
  });

  it('页面不渲染凭证名或私有服务端域名', () => {
    const { wrapper } = mountHome();
    expect(wrapper.html()).not.toContain('QODER_ACCESS_TOKEN');
    expect(wrapper.html()).not.toContain('Authorization');
    expect(wrapper.html()).not.toContain('api.qoder.com.cn');
  });
});
