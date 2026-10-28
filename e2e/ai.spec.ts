import { expect, test, type Locator, type Page } from '@playwright/test';

async function playerPosition(canvas: Locator) {
  return canvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = 960, maxX = -1, minY = 540, maxY = -1;
    for (let y = 70; y < 540; y += 1) for (let x = 0; x < 960; x += 1) {
      const i = (y * 960 + x) * 4;
      if (data[i] === 197 && data[i + 1] === 242 && data[i + 2] === 119) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    return maxX >= 0 ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2, bottom: maxY } : null;
  });
}

async function choose(page: Page, provider: 'gemini' | 'groq') {
  const toggle = page.getByRole('button', { name: /Settings/ });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(page.getByLabel('AI Provider')).toBeEnabled();
  await page.getByLabel('AI Provider').selectOption(provider);
}

async function generate(page: Page, prompt: string) {
  await page.getByLabel('Bạn muốn tạo game gì?').fill(prompt);
  await page.getByRole('button', { name: 'Generate Game' }).click();
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  await page.locator('iframe').scrollIntoViewIfNeeded();
  const canvas = page.frameLocator('iframe').locator('canvas');
  await expect.poll(() => playerPosition(canvas)).not.toBeNull();
  await canvas.click({ position: { x: 40, y: 40 } });
  return canvas;
}

test('settings makes no hidden provider calls and persists only provider/model selection', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', (request) => { if (request.method() === 'POST') calls.push(request.url()); });
  await page.goto('/');
  await choose(page, 'gemini');
  expect(calls).toEqual([]);
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(page.getByText(/API key và model truy cập được/)).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain('/api/ai/test-connection');
  await choose(page, 'groq');
  await page.getByLabel('Model', { exact: true }).selectOption('llama-3.3-70b-versatile');
  await page.reload();
  await page.getByRole('button', { name: /Settings/ }).click();
  await expect(page.getByLabel('AI Provider')).toHaveValue('groq');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('llama-3.3-70b-versatile');
  const stored = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  expect(stored).toEqual({ 'game-creator.provider.v1': JSON.stringify({ providerId: 'groq', modelId: 'llama-3.3-70b-versatile' }) });
  expect(calls).toHaveLength(1);
});

test('Gemini platformer and Groq top-down collect coins, win and restart in sandbox', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await choose(page, 'gemini');
  let canvas = await generate(page, 'Tạo game platformer ninja nhặt xu và tránh quái');
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  expect(await canvas.evaluate(() => { try { void parent.document; return false; } catch { return true; } })).toBe(true);
  await expect.poll(async () => (await playerPosition(canvas))?.bottom ?? 0).toBeGreaterThan(495);
  await page.keyboard.down('ArrowRight');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Bạn thắng!' })).toBeVisible();
  await page.keyboard.up('ArrowRight');
  await expect(page.frameLocator('iframe').locator('#game-hud')).toContainText('Điểm 10');
  await page.keyboard.press('r');
  await expect(page.frameLocator('iframe').getByRole('dialog')).toBeHidden();
  await expect(page.frameLocator('iframe').locator('#game-hud')).toContainText('Điểm 0');
  await choose(page, 'groq');
  canvas = await generate(page, 'Create a top-down collector');
  await page.keyboard.down('w');
  await expect.poll(async () => (await playerPosition(canvas))?.y ?? 540, { intervals: [25] }).toBeLessThan(260);
  await page.keyboard.up('w');
  await page.keyboard.press('r');
  await expect.poll(async () => (await playerPosition(canvas))?.y).toBeGreaterThan(290);
  await page.keyboard.down('d');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Bạn thắng!' })).toBeVisible();
  await page.keyboard.up('d');
  await page.frameLocator('iframe').getByRole('button', { name: 'Chơi lại (R)' }).click();
  await expect(page.frameLocator('iframe').getByRole('dialog')).toBeHidden();
  await expect(page.frameLocator('iframe').locator('#game-hud')).toContainText('Máu 2/2');
  await page.screenshot({ path: 'test-results/phase2-top-down.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('AI platformer jumps and lands on a raised platform', async ({ page }) => {
  await page.goto('/'); await choose(page, 'gemini');
  const canvas = await generate(page, 'platformer [jump]');
  await expect.poll(async () => (await playerPosition(canvas))?.bottom ?? 0).toBeGreaterThan(495);
  await page.keyboard.down('ArrowRight');
  // Jump before reaching the platform edge; jumping underneath hits its underside.
  await expect.poll(async () => (await playerPosition(canvas))?.x ?? 0, { intervals: [16] }).toBeGreaterThan(165);
  await page.keyboard.down('Space');
  await expect.poll(async () => (await playerPosition(canvas))?.bottom ?? 540, { intervals: [16] }).toBeLessThan(420);
  await expect.poll(async () => (await playerPosition(canvas))?.x ?? 0, { intervals: [16] }).toBeGreaterThan(310);
  await page.keyboard.up('Space'); await page.keyboard.up('ArrowRight');
  await expect.poll(async () => Math.abs(((await playerPosition(canvas))?.bottom ?? 0) - 409)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: 'test-results/phase2-platformer.png', fullPage: true });
});

test('top-down obstacles block movement and enemies cause loss, followed by restart', async ({ page }) => {
  await page.goto('/'); await choose(page, 'groq');
  let canvas = await generate(page, 'top-down [obstacle]');
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await playerPosition(canvas))?.x ?? 0).toBeGreaterThan(450);
  await page.waitForTimeout(200);
  expect((await playerPosition(canvas))?.x ?? 960).toBeLessThan(459);
  await page.keyboard.up('ArrowRight');
  canvas = await generate(page, 'top-down [survive]');
  await page.keyboard.down('ArrowRight');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Game over' })).toBeVisible();
  await page.keyboard.up('ArrowRight');
  await expect(page.frameLocator('iframe').locator('#game-hud')).toContainText('Máu 0/1');
  await page.keyboard.press('r');
  await expect(page.frameLocator('iframe').getByRole('dialog')).toBeHidden();
  await expect(page.frameLocator('iframe').locator('#game-hud')).toContainText('Máu 1/1');
  await expect.poll(async () => (await playerPosition(canvas))?.x).toBeLessThan(110);
});

test('quota errors are visible without provider fallback or retries', async ({ page }) => {
  let requests = 0;
  page.on('request', (request) => { if (request.url().includes('/api/games/generate')) requests += 1; });
  await page.goto('/'); await choose(page, 'gemini');
  await page.getByLabel('Bạn muốn tạo game gì?').fill('[quota]');
  await page.getByRole('button', { name: 'Generate Game' }).click();
  await expect(page.getByText('Provider đã hết quota. Hãy thử lại sau.')).toBeVisible();
  expect(requests).toBe(1);
  await expect(page.getByLabel('AI Provider')).toHaveValue('gemini');
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('unconfigured provider stays unavailable after reload', async ({ page }) => {
  await page.route('**/api/ai/providers', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ providers: [
    { id: 'gemini', name: 'Google Gemini', available: false, reason: 'missing_key', models: [] },
    { id: 'groq', name: 'Groq', available: false, reason: 'missing_key', models: [] },
  ] }) }));
  await page.goto('/'); await choose(page, 'gemini');
  await page.getByLabel('Bạn muốn tạo game gì?').fill('Tạo game ninja');
  await expect(page.getByRole('button', { name: 'Generate Game' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  await expect(page.locator('.settings-info').filter({ hasText: 'Chưa có API key' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Settings/ }).click();
  await expect(page.getByLabel('AI Provider')).toHaveValue('gemini');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('');
});
