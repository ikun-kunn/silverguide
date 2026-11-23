import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { createVisionApi } from './server/visionApi';
import { readVisionConfig } from './server/config';
import { silverguidePwaPlugin } from './build/pwa';

/** 仅运行于 Vite Node 进程，不进入浏览器构建产物。静态部署仍需独立同源适配层。 */
function visionApiPlugin(): Plugin {
  const config = readVisionConfig();
  const middleware = createVisionApi(config.provider, 85_000, config);
  return {
    name: 'silverguide-local-vision-api',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

export default defineConfig({
  plugins: [vue(), visionApiPlugin(), silverguidePwaPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.spec.ts'],
    restoreMocks: true,
    // 关闭缓存与文件级并发，避免在受限沙箱中多 worker 抢写同一临时缓存文件
    cache: false,
    fileParallelism: false,
  },
});
