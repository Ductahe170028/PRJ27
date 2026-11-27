import { expect, test, type Locator, type Page } from '@playwright/test';

// Stage 6A: switching weapons in the game (keys 1-5, the mouse wheel), seen through the hidden HUD.

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
  // focus the game WITHOUT shooting (a click would fire): the canvas takes keys when it has focus
  await canvas.evaluate((element) => (element as HTMLElement).focus());
  return { frame, canvas, hud, errors, result: frame.locator('#game-result') };
}
const weapon = (hud: Locator) => hud.getAttribute('data-weapon');
const sample = (hud: Locator) => hud.evaluate((el) => ({ equip: el.getAttribute('data-equip'), bullets: Number(el.getAttribute('data-bullets')), weapon: el.getAttribute('data-weapon'), slot: el.getAttribute('data-slot') }));
const SLOW = { timeout: 3000 };

test('arsenal: starts with the pistol; key 2 puts the shotgun in hand, and the switch lasts about 300 ms', async ({ page }) => {
  const { hud, errors } = await open(page, 'arsenal');
  await expect(hud).toHaveAttribute('data-weapon', 'pistol');
  await expect(hud).toHaveAttribute('data-slot', '0');
  await expect(hud).toHaveAttribute('data-equip', 'no');
  await page.keyboard.press('2');
  await expect(hud).toHaveAttribute('data-weapon', 'shotgun');
  await expect(hud).toHaveAttribute('data-slot', '1');
  await expect(hud).toHaveAttribute('data-equip', 'yes', { timeout: 1000 });
  await expect(hud).toHaveAttribute('data-equip', 'no', SLOW);
  expect(errors).toEqual([]);
});

test('no shot comes out while switching, even with the trigger held; one comes soon after', async ({ page }) => {
  const { canvas, hud } = await open(page, 'arsenal');
  await expect(hud).toHaveAttribute('data-bullets', '0');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5);
  await page.keyboard.press('4');
  await page.mouse.down();
  let during = 0;
  for (let i = 0; i < 40; i += 1) {
    const s = await sample(hud);
    if (s.equip === 'yes') { during += 1; expect(s.bullets, `a bullet appeared while switching (sample ${i})`).toBe(0); }
    else if (s.bullets > 0) break;
    await page.waitForTimeout(8);
  }
  expect(during).toBeGreaterThan(0); // we really did look while it was switching
  await expect.poll(async () => (await sample(hud)).bullets, SLOW).toBeGreaterThan(0);
  await page.mouse.up();
});

test('keys 5, 4, 3, 1 in turn put the right weapon in hand; 6 and 0 do nothing', async ({ page }) => {
  const { hud } = await open(page, 'arsenal');
  for (const [key, id, slot] of [['5', 'heavy', '4'], ['4', 'rapid', '3'], ['3', 'piercing', '2'], ['1', 'pistol', '0']] as const) {
    await page.keyboard.press(key);
    await expect(hud).toHaveAttribute('data-weapon', id);
    await expect(hud).toHaveAttribute('data-slot', slot);
    await expect(hud).toHaveAttribute('data-equip', 'no', SLOW);
  }
  for (const key of ['6', '0', '7', '9']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
    expect(await weapon(hud), key).toBe('pistol');
  }
});

test('the number pad works as well as the digit row', async ({ page }) => {
  const { hud } = await open(page, 'arsenal');
  await page.keyboard.press('Numpad3');
  await expect(hud).toHaveAttribute('data-weapon', 'piercing');
  await page.keyboard.press('Numpad5');
  await expect(hud).toHaveAttribute('data-weapon', 'heavy');
});

test('the mouse wheel goes round the weapons: down is next, up is back, past the ends it comes round', async ({ page }) => {
  const { canvas, hud } = await open(page, 'arsenal');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const turn = async (deltaY: number, id: string) => {
    await page.mouse.wheel(0, deltaY);
    await expect(hud).toHaveAttribute('data-weapon', id);
    await page.waitForTimeout(280); // a notch each time, and each after the last has been used
  };
  await turn(100, 'shotgun');
  await turn(100, 'piercing');
  await turn(-100, 'shotgun');
  await turn(-100, 'pistol');
  await turn(-100, 'heavy'); // back from the first is the last
  await turn(100, 'pistol'); // forward from the last is the first
});

test('R plays again with the weapon the level starts with', async ({ page }) => {
  const { hud } = await open(page, 'arsenal');
  await page.keyboard.press('5');
  await expect(hud).toHaveAttribute('data-weapon', 'heavy');
  await page.keyboard.press('r');
  await expect(hud).toHaveAttribute('data-weapon', 'pistol');
  await expect(hud).toHaveAttribute('data-slot', '0');
  await expect(hud).toHaveAttribute('data-equip', 'no');
});

test('with one weapon (&loadout=single) or in an older level, key 2 does nothing and there is no weapon bar', async ({ page }) => {
  for (const query of ['arsenal&loadout=single', 'arena', 'smoke-win']) {
    const { hud, errors } = await open(page, query);
    await page.keyboard.press('2');
    await page.keyboard.press('3');
    await page.mouse.move(300, 300);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(250);
    for (const name of ['data-weapon', 'data-slot', 'data-equip', 'data-weapon-bar']) await expect(hud, `${query} ${name}`).not.toHaveAttribute(name, /.*/);
    await expect(hud).toContainText('Máu');
    expect(errors, query).toEqual([]);
  }
});

test('the weapon bar has one cell per weapon, and the three bars do not overlap', async ({ page }) => {
  test.setTimeout(60_000);
  const bounds = async (hud: Locator, name: string) => {
    const [x, y, width, height] = ((await hud.getAttribute(name)) ?? '').split(',').map(Number) as [number, number, number, number];
    return { x, y, width, height };
  };
  const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  // five weapons: five cells of 40 and four gaps of 6, with a margin of 6 on each side
  const { hud } = await open(page, 'arsenal&boss=crusher');
  await expect(hud).toHaveAttribute('data-weapon-bar', /^\d+,\d+,\d+,\d+$/);
  const bar = await bounds(hud, 'data-weapon-bar');
  expect(bar.width).toBe(5 * 40 + 4 * 6 + 12);
  expect(Math.abs(bar.x + bar.width / 2 - 480)).toBeLessThanOrEqual(1);
  expect(bar.y + bar.height).toBeLessThanOrEqual(540);
  await expect(hud).toHaveAttribute('data-boss-max', /^\d+$/, { timeout: 25_000 });
  expect(overlap(bar, await bounds(hud, 'data-boss-bar'))).toBe(false);
  // a generated level with a base (the mock provider's [brief:base]): the base's bar is not touched either, and the weapon bar is there too
  await page.goto('/');
  const toggle = page.getByRole('button', { name: /Settings/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.getByLabel('AI Provider').selectOption('groq');
  await page.getByLabel('Bạn muốn tạo game gì?').fill('bảo vệ căn cứ khỏi zombie trong 60 giây [brief:base]');
  await page.getByRole('button', { name: 'Generate Game' }).click();
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  const generated = page.frameLocator('iframe').locator('#game-hud');
  await expect(generated).toHaveAttribute('data-weapon-bar', /^[0-9]+,[0-9]+,[0-9]+,[0-9]+$/);
  await expect(generated).toHaveAttribute('data-base-bar', /^[0-9]+,[0-9]+,[0-9]+,[0-9]+$/);
  expect(overlap(await bounds(generated, 'data-weapon-bar'), await bounds(generated, 'data-base-bar'))).toBe(false);
  expect(await weapon(generated)).toBe('pistol');
});

test('the banner has the hint for switching weapons in a level that has an arsenal, and the old one only elsewhere', async ({ page }) => {
  const arsenal = await open(page, 'arsenal');
  await expect(arsenal.frame.locator('#game-banner')).toContainText('WASD di chuyển · chuột ngắm và bắn · R chơi lại');
  await expect(arsenal.frame.locator('#game-banner')).toContainText('1–5 hoặc cuộn chuột: đổi súng');
  const arena = await open(page, 'arena');
  await expect(arena.frame.locator('#game-banner')).toContainText('WASD di chuyển · chuột ngắm và bắn · R chơi lại');
  await expect(arena.frame.locator('#game-banner')).not.toContainText('đổi súng');
});

test('the level card lists the weapons and the one the player starts with', async ({ page }) => {
  await open(page, 'arsenal');
  const card = page.getByRole('region', { name: 'Thông tin màn' });
  await expect(card.locator('[data-info="arsenal"]')).toContainText('1 · Súng ngắn');
  await expect(card.locator('[data-info="arsenal"]')).toContainText('5 · Súng nặng');
  await expect(card.locator('[data-info="arsenal"]')).toContainText('Súng lúc đầu: Súng ngắn');
  await open(page, 'arena');
  await expect(card.locator('[data-info="arsenal"]')).toHaveCount(0);
});
