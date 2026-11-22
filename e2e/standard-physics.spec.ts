import { expect, test, type Locator, type Page } from '@playwright/test';

// Real Phaser Arcade checks for the physics the API simulator claims
// (platformer-physics.ts). Fixtures come from apps/api/test/fixtures/standard
// through the production parse and repair path. Only outcomes are asserted
// (which surface the player stands on, whether the coin was picked), with
// tolerances; spawn points sit in the middle of wide start windows so key
// timing in Playwright does not matter.

// Player pixels of the synthetic fixtures: theme.player #c5f277.
async function playerBox(canvas: Locator) {
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
    return maxX >= 0 ? { x: (minX + maxX) / 2, top: minY, bottom: maxY } : null;
  });
}

async function load(page: Page, fixture: string) {
  await page.goto('/?legacy=standard');
  const toggle = page.getByRole('button', { name: /Settings/ });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(page.getByLabel('AI Provider')).toBeEnabled();
  await page.getByLabel('AI Provider').selectOption('groq');
  await page.getByLabel('Bạn muốn tạo game gì?').fill(`platformer [fixture:${fixture}]`);
  await page.getByRole('button', { name: 'Generate Game' }).click();
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  await page.locator('iframe').scrollIntoViewIfNeeded();
  const canvas = page.frameLocator('iframe').locator('canvas');
  await expect.poll(() => playerBox(canvas)).not.toBeNull();
  await canvas.click({ position: { x: 40, y: 40 } });
  return canvas;
}

/** Samples the player until `done` holds; returns every sample. */
async function track(canvas: Locator, done: () => Promise<boolean>, timeout = 6_000) {
  const samples: Array<{ x: number; top: number; bottom: number }> = [];
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const box = await playerBox(canvas);
    if (box) samples.push(box);
    if (await done()) break;
  }
  return samples;
}

const settled = async (canvas: Locator, bottom: number) =>
  expect.poll(async () => Math.abs(((await playerBox(canvas))?.bottom ?? 0) - bottom)).toBeLessThanOrEqual(2);

test('landing: a jump within reach ends standing on the platform and picks its coin', async ({ page }) => {
  const canvas = await load(page, 'landing');
  await settled(canvas, 499);
  const hud = page.frameLocator('iframe').locator('#game-hud');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  await expect(hud).toContainText('Điểm 10');
  await page.keyboard.up('ArrowRight');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Bạn thắng!' })).toBeVisible();
  await settled(canvas, 409); // platform top y=410
});

test('out of reach: a platform 180px up is never reached, the player stays on the floor', async ({ page }) => {
  const canvas = await load(page, 'out-of-reach');
  await settled(canvas, 499);
  const hud = page.frameLocator('iframe').locator('#game-hud');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Space');
  const samples = await track(canvas, async () => (await hud.textContent())?.includes('Điểm 10') ?? false);
  await page.keyboard.up('Space');
  await page.keyboard.up('ArrowRight');
  await expect(hud).toContainText('Điểm 10'); // floor coin at x=820, past the platform
  // Platform top is y=320. Highest jump keeps the body bottom near 374.
  expect(Math.min(...samples.map((s) => s.bottom))).toBeGreaterThan(340);
  await settled(canvas, 499);
});

test('underside: a jump under a platform hits it, keeps below it and falls back', async ({ page }) => {
  const canvas = await load(page, 'underside');
  await settled(canvas, 499);
  await page.keyboard.down('Space');
  const samples = await track(canvas, async () => false, 900);
  await page.keyboard.up('Space');
  const highest = Math.min(...samples.map((s) => s.top));
  // Platform bottom is y=410. A free jump would bring the top to about 346.
  expect(highest).toBeGreaterThanOrEqual(408);
  expect(highest).toBeLessThanOrEqual(418);
  await settled(canvas, 499);
});

test('drop: walking off a high platform lands on the lower one', async ({ page }) => {
  const canvas = await load(page, 'drop');
  await settled(canvas, 289); // spawn platform top y=290
  const hud = page.frameLocator('iframe').locator('#game-hud');
  await page.keyboard.down('ArrowRight');
  await expect(hud).toContainText('Điểm 10'); // coin on the lower platform
  await page.keyboard.up('ArrowRight');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Bạn thắng!' })).toBeVisible();
  await settled(canvas, 389); // lower platform top y=390
});

test('world top (2ef2 platforms): the jump from platform 3 bumps y=70 and lands on platform 4', async ({ page }) => {
  const canvas = await load(page, '2ef2-ceiling');
  await settled(canvas, 179); // platform 3 top y=180
  const hud = page.frameLocator('iframe').locator('#game-hud');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Space');
  const samples = await track(canvas, async () => (await hud.textContent())?.includes('Điểm 10') ?? false);
  await page.keyboard.up('Space');
  await page.keyboard.up('ArrowRight');
  await expect(hud).toContainText('Điểm 10'); // coin 4 of 2ef2 at (890,95)
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Bạn thắng!' })).toBeVisible();
  expect(Math.min(...samples.map((s) => s.top))).toBeLessThanOrEqual(72); // touched the world top
  await settled(canvas, 109); // platform 4 top y=110
});
