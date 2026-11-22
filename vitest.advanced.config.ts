import { defineConfig } from 'vitest/config';
import { ADVANCED_TESTS } from './vitest.advanced-files.js';

// FROZEN: Advanced Mode tests only (see vitest.advanced-files.ts).
export default defineConfig({
  test: { include: ADVANCED_TESTS, environment: 'node' },
});
