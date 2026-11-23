import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '@/views/HomeView.vue';
import PracticeView from '@/views/PracticeView.vue';
import ProgressView from '@/views/ProgressView.vue';
import SettingsView from '@/views/SettingsView.vue';
import TrainingView from '@/views/TrainingView.vue';
import AiHelperView from '@/views/AiHelperView.vue';
import AboutView from '@/views/AboutView.vue';

/** M2：全部 TRD 页面路由。 */
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/practice', name: 'practice', component: PracticeView },
    {
      path: '/practice/:taskId',
      name: 'training',
      component: TrainingView,
      props: true,
    },
    { path: '/progress', name: 'progress', component: ProgressView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/ai-helper', name: 'ai-helper', component: AiHelperView },
    { path: '/about', name: 'about', component: AboutView },
    { path: '/:pathMatch(.*)*', redirect: { name: 'home' } },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
