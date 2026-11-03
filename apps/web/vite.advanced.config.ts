import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
export default defineConfig({ publicDir: false, build: { target: 'es2022', outDir: 'public/runtime', emptyOutDir: false, copyPublicDir: false,
  lib: { entry: fileURLToPath(new URL('./src/game/code-runtime.ts', import.meta.url)), name: 'CodeGameRuntime', formats: ['iife'], fileName: () => 'advanced.js' },
} });
