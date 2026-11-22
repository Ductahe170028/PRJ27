import { expect, test } from '@playwright/test';

// Advanced is off by default. This spec runs against the same mock server
// started with E2E_ADVANCED=0 (port 3102, web preview on 5175).
test.use({ baseURL: 'http://127.0.0.1:5175' });

test('with Advanced off there is no mode switch and Standard still generates a game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const config = page.waitForResponse((response) => response.url().endsWith('/api/agent/config'));
  await page.goto('/');
  await expect(page.getByText('Backend đã kết nối')).toBeVisible();

  const answer = await config;
  expect(await answer.json()).toMatchObject({ enabled: false });

  // The config answer has been received: the switch must still be absent.
  await expect(page.getByRole('group', { name: 'Chế độ tạo game' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Advanced AI Mode/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Standard Mode/ })).toHaveCount(0);

  await page.getByLabel('Bạn muốn tạo game gì?').fill('Một game platformer dưới ánh trăng');
  await page.getByRole('button', { name: 'Generate Game' }).click();
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the Advanced endpoints answer "unavailable" while it is off', async ({ request }) => {
  const config = await request.get('/api/agent/config');
  expect(config.status()).toBe(200);
  expect(await config.json()).toMatchObject({ enabled: false });
  const generate = await request.post('/api/agent/generate', { data: { prompt: 'x', providerId: 'groq' } });
  expect(generate.status()).toBe(403);
});
