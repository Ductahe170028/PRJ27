import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['api/test/**/*.test.ts', 'web/test/**/*.test.tsx'],
    environment: 'node',
    restoreMocks: true,
    clearMocks: true,
  },
});
