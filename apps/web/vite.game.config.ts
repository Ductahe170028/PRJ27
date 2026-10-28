import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// A classic, self-contained script can load in an opaque-origin iframe without
// weakening the sandbox or allowing CORS access to the application's modules.
export default defineConfig({
  publicDir: false,
  build: {
    target: 'es2022',
    outDir: 'public/runtime',
    // Keep the last bundle available while the dev watcher rebuilds it.
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/game/runtime.ts', import.meta.url)),
      name: 'DemoGameRuntime',
      formats: ['iife'],
      fileName: () => 'game.js',
    },
  },
});
