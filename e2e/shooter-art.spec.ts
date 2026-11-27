import { expect, test, type Page } from '@playwright/test';

// Stage 5A: the look of the game (art packs, drawn by code or PNG), seen through the hidden HUD of the playground.

async function open(page: Page, query: string) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`/?shooter=${query}`);
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('canvas')).toBeVisible();
  const hud = frame.locator('#game-hud');
  await expect(hud).toContainText('Máu');
  return { frame, hud, errors, result: frame.locator('#game-result') };
}

test('art-showcase: the hidden HUD tells how the level looks, and the game runs with the packs drawn by code', async ({ page }) => {
  const { hud, errors } = await open(page, 'art-showcase');
  await expect(hud).toHaveAttribute('data-look', 'biome:military-base;hero:scout;family:bug;base:bunker;weapon:pistol');
  await expect(hud).toHaveAttribute('data-art-fallbacks', '0');
  await expect(hud).toHaveAttribute('data-art-sources', /biome\/military-base:procedural;hero\/scout:procedural/);
  await expect(hud).toContainText('Giữ căn cứ');
  await expect(hud).toHaveAttribute('data-base-hp', /^\d+$/);
  expect(errors).toEqual([]);
});

test('the address changes how the level looks: biome, hero, family, base and weapon; a strange value is ignored', async ({ page }) => {
  const { hud } = await open(page, 'art-showcase&biome=ice-base&hero=armor&family=robot&base=outpost&weapon=shotgun');
  await expect(hud).toHaveAttribute('data-look', 'biome:ice-base;hero:armor;family:robot;base:outpost;weapon:shotgun');
  const odd = await open(page, 'art-showcase&biome=moon&hero=%3Cb%3E&family=dragon&weapon=rocket');
  await expect(odd.hud).toHaveAttribute('data-look', 'biome:military-base;hero:scout;family:bug;base:bunker;weapon:pistol');
});

test('every scenery can be opened: eight biomes, each runs without an error and says its name', async ({ page }) => {
  test.setTimeout(90_000);
  for (const biome of ['zombie-city', 'alien-lab', 'dark-forest', 'desert-ruins', 'ice-base', 'neon-arena', 'hospital', 'military-base']) {
    const { hud, errors } = await open(page, `art-showcase&biome=${biome}`);
    await expect(hud).toHaveAttribute('data-look', new RegExp(`^biome:${biome};`));
    expect(errors, biome).toEqual([]);
  }
});

test('a boss from the address: the boss comes and the HUD says "Hạ boss"', async ({ page }) => {
  test.setTimeout(60_000);
  const { hud } = await open(page, 'art-showcase&boss=crusher');
  await expect(hud).toContainText('Hạ boss');
  await expect(hud).toHaveAttribute('data-boss-max', /^\d+$/, { timeout: 25_000 });
});

test('art-test: the hero comes from the PNG pack grunt-test, through the page, with no fallback', async ({ page }) => {
  const { hud, errors } = await open(page, 'art-test');
  await expect(hud).toHaveAttribute('data-look', /hero:grunt-test/);
  await expect(hud).toHaveAttribute('data-art-fallbacks', '0');
  await expect(hud).toHaveAttribute('data-art-sources', /hero\/grunt-test:png/);
  expect(errors).toEqual([]);
});

test('a PNG that is not a picture, or a manifest that is missing, does not stop the game: the pack is drawn by code and counted', async ({ page }) => {
  await page.route('**/art/hero/grunt-test/sheet.png', (route) => route.fulfill({ contentType: 'image/png', body: Buffer.from('this is not a png at all') }));
  const garbage = await open(page, 'art-test');
  await expect(garbage.hud).toHaveAttribute('data-art-fallbacks', '1');
  await expect(garbage.hud).toHaveAttribute('data-art-sources', /hero\/scout:procedural/);
  await page.unroute('**/art/hero/grunt-test/sheet.png');
  await page.route('**/art/hero/grunt-test/manifest.json', (route) => route.fulfill({ status: 404, body: 'nope' }));
  const missing = await open(page, 'art-test');
  await expect(missing.hud).toHaveAttribute('data-art-fallbacks', '1');
  await expect(missing.hud).toContainText('Máu');
  await page.unroute('**/art/hero/grunt-test/manifest.json');
  await page.route('**/art/index.json', (route) => route.fulfill({ status: 500, body: 'down' }));
  const noIndex = await open(page, 'art-test');
  await expect(noIndex.hud).toHaveAttribute('data-art-sources', /hero\/scout:procedural/);
});

test('a game lost because the base fell still shows the result table and its reason, after the base crumbles', async ({ page }) => {
  test.setTimeout(60_000);
  const { frame, hud, result } = await open(page, 'base-fall');
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(frame.locator('#result-title')).toHaveText('Game over');
  await expect(frame.locator('#result-detail')).toContainText('Căn cứ đã bị phá.');
  await expect(hud).toHaveAttribute('data-lost-by', 'base');
});

test('the positions published on the hidden HUD are the real ones, not the smoothed ones', async ({ page }) => {
  const { hud } = await open(page, 'arena');
  const [x, y] = ((await hud.getAttribute('data-player-at')) ?? '').split(',').map(Number);
  expect(x).toBe(480);
  expect(y).toBe(305);
});

test('the hero and the base are really drawn where the game says they are (pixels, not only attributes)', async ({ page }) => {
  const { frame, hud } = await open(page, 'art-showcase');
  const canvas = frame.locator('canvas');
  await page.waitForTimeout(600);
  const [x, y] = ((await hud.getAttribute('data-player-at')) ?? '').split(',').map(Number);
  // the sprites have a dark outline (#0b1220); count those pixels in a box around the hero, around the base, and in an empty corner
  const outlined = (cx: number, cy: number) => canvas.evaluate((element, [bx, by]) => {
    const c = element as HTMLCanvasElement;
    const data = c.getContext('2d')!.getImageData(Math.round(bx! - 24), Math.round(by! - 24), 48, 48).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! < 24 && data[i + 1]! < 30 && data[i + 2]! < 50 && data[i + 3]! > 200) count += 1;
    return count;
  }, [cx, cy] as const);
  expect(await outlined(x!, y!)).toBeGreaterThan(30);
  expect(await outlined(480, 305)).toBeGreaterThan(30);
});
