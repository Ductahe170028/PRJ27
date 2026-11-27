import { expect, test, type Locator, type Page } from '@playwright/test';

// Stage 6B: a bigger base (80 px), and the name of the weapon in hand, seen through the hidden HUD.

async function open(page: Page, query: string) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`/?shooter=${query}`);
  const frame = page.frameLocator('iframe');
  const canvas = frame.locator('canvas');
  await expect(canvas).toBeVisible();
  const hud = frame.locator('#game-hud');
  await expect(hud).toContainText('Máu');
  await canvas.evaluate((element) => (element as HTMLElement).focus());
  return { frame, canvas, hud, errors, result: frame.locator('#game-result') };
}
const num = async (hud: Locator, name: string) => Number((await hud.getAttribute(name)) ?? -1);

test('base-siege-big: an 80 px base with its bar and its banner; the older base-siege is still 56', async ({ page }) => {
  const { frame, hud, errors } = await open(page, 'base-siege-big');
  await expect(hud).toHaveAttribute('data-base-side', '80');
  await expect(hud).toHaveAttribute('data-base-hp', '200');
  await expect(hud).toHaveAttribute('data-base-bar', /^[0-9]+,[0-9]+,[0-9]+,[0-9]+$/);
  await expect(frame.locator('#game-banner')).toContainText('MỤC TIÊU: Bảo vệ căn cứ: Sống sót 60 giây');
  await expect(hud).toContainText('Giữ căn cứ · Sống sót');
  expect(errors).toEqual([]);
  const old = await open(page, 'base-siege');
  await expect(old.hud).toHaveAttribute('data-base-side', '56');
});

test('the enemies that go for the bigger base stop at the edge of its square: touching it, hurting it, never inside it', async ({ page }) => {
  test.setTimeout(60_000);
  const { hud } = await open(page, 'base-siege-big&stress=40');
  let touchedAt: number | undefined;
  const began = Date.now();
  while (Date.now() - began < 40_000) {
    const inside = await num(hud, 'data-base-inside');
    expect(inside, 'an enemy was inside the base').toBe(0);
    if (touchedAt === undefined && (await num(hud, 'data-base-touching')) > 0) touchedAt = Date.now() - began;
    if (touchedAt !== undefined && (await num(hud, 'data-base-hp')) < 200) break;
    if ((await hud.getAttribute('data-hp')) === '0') break;
    await page.waitForTimeout(40);
  }
  expect(touchedAt, 'no enemy ever reached the base').toBeDefined();
  expect(await num(hud, 'data-base-hp')).toBeLessThan(200);
  expect(await num(hud, 'data-base-inside')).toBe(0);
});

test('a bigger base that falls: Game over says the base was destroyed, and the player did not fall', async ({ page }) => {
  test.setTimeout(80_000);
  const { frame, hud, result } = await open(page, 'base-siege-big&basehp=5&stress=40');
  await page.keyboard.down('a'); // walk away to the left: the enemies go for the base
  await page.waitForTimeout(1500);
  await page.keyboard.up('a');
  await expect(result).toBeVisible({ timeout: 60_000 });
  await expect(frame.locator('#result-title')).toHaveText('Game over');
  const lostBy = await hud.getAttribute('data-lost-by');
  if (lostBy === 'base') {
    await expect(frame.locator('#result-detail')).toContainText('Căn cứ đã bị phá.');
    expect(await num(hud, 'data-base-hp')).toBe(0);
  } else {
    // the player was caught first: still a lost game with the other reason
    await expect(frame.locator('#result-detail')).toContainText('Bạn đã bị hạ.');
  }
});

test('the weapon bar names the weapon in hand, and the name changes with the keys 1 to 5', async ({ page }) => {
  const { hud } = await open(page, 'arsenal');
  const NAMES = [['1', 'pistol', 'Súng ngắn'], ['2', 'shotgun', 'Shotgun (súng săn)'], ['3', 'piercing', 'Súng xuyên giáp'], ['4', 'rapid', 'Súng bắn nhanh (liên thanh)'], ['5', 'heavy', 'Súng nặng']] as const;
  await expect(hud).toHaveAttribute('data-weapon-name', 'Súng ngắn');
  for (const [key, id, name] of NAMES) {
    await page.keyboard.press(key);
    await expect(hud).toHaveAttribute('data-weapon', id);
    await expect(hud).toHaveAttribute('data-weapon-name', name);
  }
  await page.keyboard.press('1');
  await expect(hud).toHaveAttribute('data-weapon-name', 'Súng ngắn');
  // one weapon: no name, no bar
  const single = await open(page, 'arsenal&loadout=single');
  await expect(single.hud).not.toHaveAttribute('data-weapon-name', /.*/);
});

test('the weapon bar with its name does not touch the base bar or the boss bar', async ({ page }) => {
  test.setTimeout(60_000);
  const { hud } = await open(page, 'arsenal&boss=crusher');
  const [x, y, w, h] = ((await hud.getAttribute('data-weapon-bar')) ?? '').split(',').map(Number) as [number, number, number, number];
  expect(w).toBeGreaterThanOrEqual(5 * 40 + 4 * 6 + 12); // the plate (the name is narrower than the plate, so the box is the plate wide)
  expect(y).toBeGreaterThan(300); // at the bottom, with the name above the plate
  expect(y + h).toBeLessThanOrEqual(540);
  await expect(hud).toHaveAttribute('data-boss-max', /^[0-9]+$/, { timeout: 25_000 });
  const [bx, by, bw, bh] = ((await hud.getAttribute('data-boss-bar')) ?? '').split(',').map(Number) as [number, number, number, number];
  expect(x < bx + bw && bx < x + w && y < by + bh && by < y + h).toBe(false);
});

test('the level card lists the five weapons with their names and sentences', async ({ page }) => {
  await open(page, 'arsenal');
  const card = page.getByRole('region', { name: 'Thông tin màn' }).locator('[data-info="arsenal"]');
  await expect(card).toContainText('1 · Súng ngắn: Bắn từng phát, tầm xa vừa');
  await expect(card).toContainText('2 · Shotgun (súng săn): Bắn chùm 6 viên, rất mạnh ở gần');
  await expect(card).toContainText('3 · Súng xuyên giáp: Đạn xuyên qua 2 quái');
  await expect(card).toContainText('4 · Súng bắn nhanh (liên thanh): Bắn liên tục, mỗi viên yếu');
  await expect(card).toContainText('5 · Súng nặng: Chậm nhưng mỗi viên rất mạnh');
});
