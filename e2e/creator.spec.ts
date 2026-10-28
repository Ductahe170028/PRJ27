import { expect, test, type Locator, type Page } from '@playwright/test';

// Inspect the actual canvas pixels so movement/landing tests exercise rendering,
// keyboard focus and Arcade Physics without adding a test API to the runtime.
async function readPlayer(canvas: Locator) {
  return canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Expected canvas');
    const context = element.getContext('2d');
    if (!context) throw new Error('Missing 2D context');
    const { data, width, height } = context.getImageData(0, 0, element.width, element.height);
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        if (data[offset] === 197 && data[offset + 1] === 242 && data[offset + 2] === 119) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
    return maxX >= 0 ? { x: (minX + maxX) / 2, top: minY, bottom: maxY } : null;
  });
}

async function generate(page: Page, prompt = 'Một game platformer dưới ánh trăng') {
  await page.getByLabel('Bạn muốn tạo game gì?').fill(prompt);
  await page.getByRole('button', { name: 'Generate Game' }).click();
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  const canvas = page.frameLocator('iframe').locator('canvas');
  await expect(canvas).toBeVisible();
  // Scroll the outer frame first: offscreen iframe animation frames may be
  // throttled on mobile, including Playwright's inner stability checks.
  await page.locator('iframe').scrollIntoViewIfNeeded();
  await expect.poll(() => readPlayer(canvas)).not.toBeNull();
  return canvas;
}

test('generates an isolated game, moves, jumps, and lands on a raised platform', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Backend đã kết nối')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate Game' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/workspace-empty.png', fullPage: true });
  const canvas = await generate(page, 'Khám phá thành phố </script><script>window.__promptExecuted=true</script>');
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  const isolated = await canvas.evaluate(() => {
    try { void window.parent.document; return false; } catch { return true; }
  });
  expect(isolated).toBe(true);
  expect(await page.evaluate(() => '__promptExecuted' in window)).toBe(false);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await expect.poll(async () => (await readPlayer(canvas))?.bottom ?? 0).toBeGreaterThanOrEqual(498);
  await canvas.click({ position: { x: 50, y: 50 } });
  const initial = await readPlayer(canvas);
  if (!initial) throw new Error('Player was not rendered');
  expect(initial.bottom).toBeLessThanOrEqual(502);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(160);
  await page.keyboard.up('ArrowRight');
  const moved = await readPlayer(canvas);
  expect(moved?.x ?? 0).toBeGreaterThan((initial?.x ?? 0) + 20);

  await page.keyboard.down('Space');
  await page.waitForTimeout(130);
  const jumping = await readPlayer(canvas);
  await page.keyboard.up('Space');
  expect(jumping?.bottom ?? 540).toBeLessThan(460);
  await expect.poll(async () => Math.abs(((await readPlayer(canvas))?.bottom ?? 0) - initial.bottom)).toBeLessThanOrEqual(1);

  await page.keyboard.press('r');
  await expect.poll(async () => (await readPlayer(canvas))?.x).toBeLessThan(100);
  await expect.poll(async () => Math.abs(((await readPlayer(canvas))?.bottom ?? 0) - initial.bottom)).toBeLessThanOrEqual(1);
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Space');
  await expect.poll(async () => (await readPlayer(canvas))?.x ?? 0, { intervals: [16, 32, 50] }).toBeGreaterThan(250);
  await page.keyboard.up('Space');
  await page.keyboard.up('ArrowRight');
  await expect.poll(async () => Math.abs(((await readPlayer(canvas))?.bottom ?? 0) - 397)).toBeLessThanOrEqual(1);
  const onPlatform = await readPlayer(canvas);
  expect(onPlatform?.x ?? 0).toBeGreaterThan(190);
  expect(onPlatform?.x ?? 960).toBeLessThan(330);
  await page.screenshot({ path: 'test-results/workspace-playing.png', fullPage: true });

  await page.getByRole('button', { name: 'Generate Game' }).click();
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('shows loading, reports a network error, and can recover', async ({ page }) => {
  await page.goto('/');
  let releaseRequest = () => {};
  const gate = new Promise<void>((resolve) => { releaseRequest = resolve; });
  await page.route('**/api/games/generate', async (route) => {
    await gate;
    await route.abort('failed');
  });
  await page.getByLabel('Bạn muốn tạo game gì?').fill('Một game có nền tảng');
  await page.getByRole('button', { name: 'Generate Game' }).click();
  await expect(page.getByText('Đang tạo dữ liệu game…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đang tạo game…' })).toBeDisabled();
  releaseRequest();
  await expect(page.getByText('Chưa thể khởi chạy game', { exact: true })).toBeVisible();
  await expect(page.getByText(/Không kết nối được backend\. Hãy chạy/)).toBeVisible();
  await page.unroute('**/api/games/generate');
  await page.getByRole('button', { name: 'Generate Game' }).click();
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
});

test('reports a failed health check and retries', async ({ page }) => {
  await page.route('**/api/health', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(page.getByText('Backend chưa kết nối')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kiểm tra lại' })).toBeVisible();
  await page.unroute('**/api/health');
  await page.getByRole('button', { name: 'Kiểm tra lại' }).click();
  await expect(page.getByText('Backend đã kết nối')).toBeVisible();
});

test('rejects invalid API data before starting the iframe', async ({ page }) => {
  await page.route('**/api/games/generate', (route) => route.fulfill({
    status: 201, contentType: 'application/json', body: JSON.stringify({ data: { code: 'alert(1)' } }),
  }));
  await page.goto('/');
  await page.getByLabel('Bạn muốn tạo game gì?').fill('Một game nhảy');
  await page.getByRole('button', { name: 'Generate Game' }).click();
  await expect(page.getByText('Dữ liệu game không hợp lệ. Hãy kiểm tra backend và thử lại.')).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('works on a narrow touch viewport without horizontal overflow', async ({ page }) => {
    await page.goto('/');
    await generate(page);
    await expect(page.frameLocator('iframe').getByRole('button', { name: 'Di chuyển trái' })).toBeVisible();
    await expect(page.frameLocator('iframe').getByRole('button', { name: 'Nhảy', exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: 'test-results/workspace-mobile.png', fullPage: true });
  });
});
