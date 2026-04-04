import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = process.cwd();

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron'] })],
    build: {
      lib: {
        entry: {
          index: resolve(root, 'electron/main.ts'),
        },
      },
      rollupOptions: {
        external: ['electron'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron'] })],
    build: {
      lib: {
        entry: resolve(root, 'electron/preload.ts'),
      },
      rollupOptions: {
        external: ['electron'],
      },
    },
  },
  renderer: {
    root: '.',
    build: {
      rollupOptions: {
        input: {
          index: resolve(root, 'index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve(root, 'src'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
