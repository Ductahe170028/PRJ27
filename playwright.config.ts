import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5174', channel: 'msedge', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: [
    { command: 'npx tsx api/test/e2e-server.ts', url: 'http://127.0.0.1:4100/api/health', reuseExistingServer: false, timeout: 30000 },
    { command: 'npm run dev:web -- --port 5174', url: 'http://127.0.0.1:5174', env: { DEV_API_PORT: '4100' }, reuseExistingServer: false, timeout: 30000 },
  ],
});
