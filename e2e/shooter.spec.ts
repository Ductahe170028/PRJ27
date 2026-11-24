import { expect, test, type Locator, type Page } from '@playwright/test';

// The shooter playground (/?shooter=<level>) needs no backend: the game runs
// in the sandboxed iframe, with the real Phaser renderer on top of the pure core.

async function open(page: Page, name: string) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`/?shooter=${name}`);
  const frame = page.frameLocator('iframe');
  const canvas = frame.locator('canvas');
  await expect(canvas).toBeVisible();
  const hud = frame.locator('#game-hud');
  await expect(hud).toContainText('Máu');
  return { frame, canvas, hud, errors, result: frame.locator('#game-result') };
}

/** Center of the pixels of the player color (#c5f277) in canvas coordinates. */
async function playerCenter(canvas: Locator) {
  return canvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let sumX = 0, sumY = 0, count = 0;
    for (let y = 70; y < 540; y += 1) for (let x = 0; x < 960; x += 1) {
      const i = (y * 960 + x) * 4;
      if (data[i] === 197 && data[i + 1] === 242 && data[i + 2] === 119) { sumX += x; sumY += y; count += 1; }
    }
    return count > 20 ? { x: sumX / count, y: sumY / count } : null;
  });
}

const kills = async (hud: Locator) => Number(/Hạ (\d+)/.exec((await hud.textContent()) ?? '')?.[1] ?? -1);

test('smoke-win: survives 10 s with no input, shows the win, and restarts from the button', async ({ page }) => {
  const { hud, result, frame, errors } = await open(page, 'smoke-win');
  await expect(hud).toContainText('Máu 10/10');
  await expect(result).toBeHidden();
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(frame.locator('#result-title')).toHaveText('Bạn thắng!');
  await expect(frame.locator('#result-detail')).toContainText('Điểm');
  await frame.locator('#restart-game').click();
  await expect(result).toBeHidden();
  await expect(hud).toContainText(/Sống sót [0-2]\/10s/);
  await expect(hud).toContainText('Máu 10/10');
  expect(errors).toEqual([]);
});

test('smoke-lose: shows Game over, and R plays again', async ({ page }) => {
  const { canvas, hud, result, frame, errors } = await open(page, 'smoke-lose');
  await expect(hud).toContainText('Máu 1/1');
  await canvas.click({ position: { x: 100, y: 100 } }); // focus the game while it is still running
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(frame.locator('#result-title')).toHaveText('Game over');
  await page.keyboard.press('r');
  await expect(result).toBeHidden();
  await expect(hud).toContainText('Máu 1/1');
  await expect(hud).toContainText(/Sống sót [0-2]\/30s/);
  // it can be lost and restarted again: no listener piled up, no error
  await expect(result).toBeVisible({ timeout: 15_000 });
  await frame.locator('#restart-game').click();
  await expect(result).toBeHidden();
  expect(errors).toEqual([]);
});

test('arena: WASD moves the player, the mouse aims, holding the left button shoots enemies down', async ({ page }) => {
  const { canvas, hud, result, errors } = await open(page, 'arena');
  await expect(hud).toContainText('Máu 5/5');
  await canvas.click({ position: { x: 480, y: 120 } }); // focus (and one shot)
  await expect.poll(() => playerCenter(canvas)).not.toBeNull();
  const start = (await playerCenter(canvas))!;
  await page.keyboard.down('d');
  await page.waitForTimeout(350);
  await page.keyboard.up('d');
  const moved = (await playerCenter(canvas))!;
  expect(moved.x - start.x).toBeGreaterThan(30); // 210 px/s for about 0.35 s
  await page.keyboard.down('a');
  await page.waitForTimeout(350);
  await page.keyboard.up('a');
  const back = (await playerCenter(canvas))!;
  expect(moved.x - back.x).toBeGreaterThan(30);

  const box = (await canvas.boundingBox())!;
  const toPage = (wx: number, wy: number) => ({ x: box.x + (wx / 960) * box.width, y: box.y + (wy / 540) * box.height });
  const here = toPage(back.x + 150, back.y);
  await page.mouse.move(here.x, here.y);
  await page.mouse.down(); // hold the left button: keep firing
  let angle = 0;
  // Sweep the aim around the player: enemies arriving from every side get hit.
  await expect.poll(async () => {
    angle += 0.18;
    const target = toPage(back.x + 170 * Math.cos(angle), back.y + 170 * Math.sin(angle));
    await page.mouse.move(target.x, target.y);
    if (await result.isVisible()) return -2; // the game ended before a kill: fail with a clear value
    return kills(hud);
  }, { timeout: 30_000, intervals: [60], message: 'no enemy was shot down' }).toBeGreaterThan(0);
  await page.mouse.up();
  await expect(hud).toContainText(/Điểm [1-9]/);
  expect(errors).toEqual([]);
});

test('an unknown level lists the valid ones', async ({ page }) => {
  await page.goto('/?shooter=khong-ton-tai');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('khong-ton-tai');
  await expect(alert).toContainText('arena, pillars, wall, smoke-win, smoke-lose');
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.goto('/?shooter=constructor');
  await expect(page.getByRole('alert')).toContainText('Level hợp lệ');
});

// --- Stage 4A part 1: the playground shows the same banner and HUD as the app ---

test('playground: a survive level shows the goal banner for about 3 s, then it is gone; the HUD shows the goal in one piece', async ({ page }) => {
  const { frame, hud, errors } = await open(page, 'arena');
  const banner = frame.locator('#game-banner');
  await expect(banner).toContainText('MỤC TIÊU: Sống sót 60 giây');
  await expect(banner).toContainText('WASD di chuyển · chuột ngắm và bắn · R chơi lại');
  const seen = Date.now();
  await expect(hud).toContainText(/Sống sót \d+\/60s/);
  await expect(banner).toHaveCount(0, { timeout: 4000 });
  expect(Date.now() - seen).toBeLessThan(3600);
  await expect(hud).toContainText('Máu 5/5');
  expect(errors).toEqual([]);
});

test('playground: a kill level shows "Hạ n/total" in the HUD and its goal on the banner, which comes back after the restart button', async ({ page }) => {
  const { frame, hud, errors } = await open(page, 'pillars');
  const banner = frame.locator('#game-banner');
  await expect(banner).toContainText('MỤC TIÊU: Hạ 50 quái');
  await expect(hud).toContainText('Hạ 0/50');
  await expect(hud).not.toContainText('Mục tiêu');
  await expect(banner).toHaveCount(0, { timeout: 4000 });
  await frame.locator('canvas').click({ position: { x: 100, y: 120 } });
  await page.keyboard.press('r');
  await expect(banner).toContainText('MỤC TIÊU: Hạ 50 quái');
  expect(errors).toEqual([]);
});
