import { defineConfig } from 'vite';

// 后端独立打包，不进入公开静态 dist；运行时才读取环境变量。
export default defineConfig({
  build: {
    ssr: 'server/index.ts', target: 'node20', outDir: 'dist-server', emptyOutDir: true, copyPublicDir: false,
    sourcemap: false, rollupOptions: { output: { entryFileNames: 'index.mjs' } },
  },
});
