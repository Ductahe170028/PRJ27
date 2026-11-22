import { defineConfig } from 'vitest/config';
import { ADVANCED_TESTS } from './vitest.advanced-files.js';

// Main run: Standard / shooter. Advanced (frozen) runs with `npm run test:advanced`.
export default defineConfig({
  test: { include: ['apps/*/test/**/*.test.ts'], exclude: ['**/node_modules/**', ...ADVANCED_TESTS], environment: 'node' },
});
