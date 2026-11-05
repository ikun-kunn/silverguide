import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it } from 'vitest';
import AppHeader from '@/components/AppHeader.vue';
import { router } from '@/router';

describe('M1 基础导航与路由', () => {
  it('注册首页、训练中心、训练页、学习档案和设置页', () => {
    expect(router.resolve('/').name).toBe('home');
    expect(router.resolve('/practice').name).toBe('practice');
    expect(router.resolve('/practice/hospital-registration').name).toBe('training');
    expect(router.resolve('/practice/taxi-ride').name).toBe('training');
    expect(router.resolve('/progress').name).toBe('progress');
    expect(router.resolve('/settings').name).toBe('settings');
    expect(router.resolve('/not-a-page').redirectedFrom).toBeUndefined();
    expect(router.getRoutes().some((route) => route.path === '/:pathMatch(.*)*')).toBe(true);
  });

  it('四个主要导航均有文字标签与可达链接', async () => {
    const testRouter = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/practice', component: { template: '<div />' } },
        { path: '/progress', component: { template: '<div />' } },
        { path: '/settings', component: { template: '<div />' } },
      ],
    });
    const wrapper = mount(AppHeader, { global: { plugins: [testRouter] } });
    const links = wrapper.findAll('a');
    expect(links.map((link) => link.text())).toEqual(
      expect.arrayContaining(['银龄引路人', '首页', '模拟训练', '学习档案', '设置']),
    );
    expect(links.map((link) => link.attributes('href'))).toEqual(
      expect.arrayContaining(['/', '/practice', '/progress', '/settings']),
    );
  });
});
