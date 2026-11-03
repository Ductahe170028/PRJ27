import { test, expect, type Page, type Locator } from '@playwright/test';

async function openAdvanced(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Advanced AI Mode/ }).click();
  const settings = page.getByRole('button', { name: /Settings/ });
  if (await settings.getAttribute('aria-expanded') !== 'true') await settings.click();
  await expect(page.getByLabel('AI Provider')).toBeEnabled();
  await page.getByLabel('AI Provider').selectOption('groq');
}
async function pixels(canvas: Locator, color: number) {
  return canvas.evaluate((element, rgb) => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0, totalX = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] === (rgb >> 16 & 255) && data[i + 1] === (rgb >> 8 & 255) && data[i + 2] === (rgb & 255)) { count++; totalX += (i / 4) % canvas.width; }
    return { count, x: count ? totalX / count : 0 };
  }, color);
}

test('Advanced generates real shooter code, tests it, and previews movement, bullets and restart', async ({ page }) => {
  await openAdvanced(page);
  await page.getByLabel('Bạn muốn tạo game gì?').fill('Tạo game bắn máy bay, có đạn, kẻ địch và boss');
  const response = page.waitForResponse((response) => response.url().includes('/api/agent/generate'));
  await page.getByRole('button', { name: 'Generate Game', exact: true }).click();
  await expect(page.locator('.agent-progress h2')).toContainText('Completed', { timeout: 30000 });
  expect((await response).status()).toBe(200);
  await expect(page.locator('.agent-stages .visited')).toHaveText(['Planning', 'Coding', 'Validating', 'Testing', 'Completed']);
  const iframe = page.locator('iframe');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  const frame = page.frameLocator('iframe'), canvas = frame.locator('canvas');
  await expect(canvas).toBeVisible();
  expect(await canvas.evaluate(() => { try { void parent.document; return false; } catch { return true; } })).toBe(true);
  expect(await canvas.evaluate(() => { try { localStorage.setItem('probe', 'x'); return false; } catch { return true; } })).toBe(true);
  await canvas.click({ position: { x: 400, y: 400 } });
  const before = await pixels(canvas, 12972663);
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await pixels(canvas, 12972663)).x).toBeGreaterThan(before.x + 35);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('Space');
  await expect.poll(async () => (await pixels(canvas, 16774000)).count).toBeGreaterThan(50);
  await page.keyboard.up('Space');
  await page.keyboard.press('r');
  await expect.poll(async () => (await pixels(canvas, 12972663)).x).toBeLessThan(490);
  await expect(frame.locator('#code-hud')).toContainText('Điểm 0');
  await page.screenshot({ path: 'test-results/phase3-shooter.png', fullPage: true });
});

test('a different prompt produces paddle/ball mechanics through the same agent', async ({ page }) => {
  await openAdvanced(page);
  await page.getByLabel('AI Provider').selectOption('gemini');
  await page.getByLabel('Bạn muốn tạo game gì?').fill('paddle game, đỡ bóng và phá gạch');
  await page.getByRole('button', { name: 'Generate Game', exact: true }).click();
  await expect(page.locator('.agent-progress h2')).toContainText('Completed', { timeout: 30000 });
  await expect(page.locator('.agent-plan')).toContainText('Neon Paddle');
  const canvas = page.frameLocator('iframe').locator('canvas');
  await expect(canvas).toBeVisible();
  expect((await pixels(canvas, 7659020)).count).toBeGreaterThan(1000);
  await expect(page.locator('.preview-footer')).toContainText('gemini');
});

test('preview gets heartbeat grace after tab resume but still stops an unresponsive game', async ({ page }) => {
  await openAdvanced(page);
  await page.getByLabel('Bạn muốn tạo game gì?').fill('Tạo game bắn máy bay');
  await page.getByRole('button', { name: 'Generate Game', exact: true }).click();
  const canvas = page.frameLocator('iframe').locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.preview-state')).toHaveText('Đang chạy');
  // Simulate a suspended parent tab waking before the iframe's next heartbeat.
  // Change the parent's clock only; the Phaser iframe keeps its real clock.
  const clock = await page.evaluateHandle(() => {
    const now = Date.now;
    let offset = 60_000;
    const pauseHeartbeat = (event: MessageEvent<{ channel?: string }>) => {
      if (event.data?.channel === 'code-runtime') event.stopImmediatePropagation();
    };
    window.addEventListener('message', pauseHeartbeat, true);
    Date.now = () => now() + offset;
    document.dispatchEvent(new Event('visibilitychange'));
    return {
      stall: () => { offset += 10_000; },
      restore: () => {
        Date.now = now;
        window.removeEventListener('message', pauseHeartbeat, true);
        document.dispatchEvent(new Event('visibilitychange'));
      },
    };
  });
  try {
    await page.waitForTimeout(1500); // Cross at least one watchdog tick.
    await expect(canvas).toBeVisible();
    await expect(page.locator('.agent-error')).toHaveCount(0);
    await clock.evaluate((clock) => clock.stall());
    await expect(page.locator('.agent-error')).toContainText('Preview không phản hồi');
    await expect(page.locator('iframe')).toHaveCount(0);
  } finally {
    await clock.evaluate((clock) => clock.restore());
    await clock.dispose();
  }
});

test('runtime failures are detected by real Playwright and repaired once', async ({ page }) => {
  await openAdvanced(page);
  await page.getByLabel('Bạn muốn tạo game gì?').fill('aircraft [agent-repair]');
  await page.getByRole('button', { name: 'Generate Game', exact: true }).click();
  await expect(page.locator('.agent-progress h2')).toContainText('Completed', { timeout: 35000 });
  await expect(page.locator('.preview-footer')).toContainText('1 lần sửa');
  await page.locator('.agent-logs summary').click();
  await expect(page.locator('.agent-logs pre')).not.toHaveText('Chưa có lỗi kiểm tra.');
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible();
});

test('failed repairs stop at two; quota is visible and Retry is manual', async ({ page }) => {
  test.setTimeout(60000);
  let count = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && request.url().includes('/api/agent/generate')) count++; });
  await openAdvanced(page);
  await page.getByLabel('Bạn muốn tạo game gì?').fill('aircraft [agent-fail]');
  await page.getByRole('button', { name: 'Generate Game', exact: true }).click();
  await expect(page.locator('.agent-error')).toContainText('sau 2 lần sửa', { timeout: 40000 });
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  expect(count).toBe(1);
  await page.getByLabel('Bạn muốn tạo game gì?').fill('[agent-quota]');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.agent-error')).toContainText('rate_limit');
  expect(count).toBe(2);
  await page.getByRole('button', { name: /Standard Mode/ }).click();
  await expect(page.locator('.status-panel')).toBeVisible();
});

test('an infinite generated loop is stopped by the budget and can be repaired', async ({ page }) => {
  await openAdvanced(page);
  await page.getByLabel('Bạn muốn tạo game gì?').fill('aircraft [agent-budget]');
  await page.getByRole('button', { name: 'Generate Game', exact: true }).click();
  await expect(page.locator('.agent-progress h2')).toContainText('Completed', { timeout: 35000 });
  await expect(page.locator('.preview-footer')).toContainText('1 lần sửa');
  await page.locator('.agent-logs summary').click();
  await expect(page.locator('.agent-logs pre')).toContainText('ngân sách vòng lặp/CPU');
});

test('sandbox CSP blocks a network attempt even if the static validator is bypassed by the test', async ({ page }) => {
  await openAdvanced(page);
  await page.getByLabel('Bạn muốn tạo game gì?').fill('paddle');
  await page.getByRole('button', { name: 'Generate Game', exact: true }).click();
  await expect(page.locator('.agent-progress h2')).toContainText('Completed', { timeout: 30000 });
  const canvas = page.frameLocator('iframe').locator('canvas');
  await expect(canvas).toBeVisible();
  await canvas.evaluate(async () => { try { await fetch('http://127.0.0.1:3101/api/health'); } catch { /* CSP must reject this, including loopback. */ } }).catch(() => {});
  await expect(page.locator('.agent-error')).toContainText('connect-src');
  await expect(page.locator('iframe')).toHaveCount(0);
});
