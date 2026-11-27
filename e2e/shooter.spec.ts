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

/** Where the player is, from the hidden HUD (the player is a sprite now, not a disk of one known color; the HUD gives the REAL place). */
async function playerCenter(hud: Locator) {
  const text = (await hud.getAttribute('data-player-at')) ?? '';
  const [x, y] = text.split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? { x: x!, y: y! } : null;
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
  await expect.poll(() => playerCenter(hud)).not.toBeNull();
  const start = (await playerCenter(hud))!;
  await page.keyboard.down('d');
  await page.waitForTimeout(350);
  await page.keyboard.up('d');
  const moved = (await playerCenter(hud))!;
  expect(moved.x - start.x).toBeGreaterThan(30); // 210 px/s for about 0.35 s
  await page.keyboard.down('a');
  await page.waitForTimeout(350);
  await page.keyboard.up('a');
  const back = (await playerCenter(hud))!;
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
  await expect(alert).toContainText('arena, pillars, wall, smoke-win, smoke-lose, shotgun-pit, spitters, medic, boss-crusher, boss-gunner, base-siege, base-boss, base-fall, art-showcase, art-test');
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

// --- Stage 4B: the new mechanics are on screen and in the state the page can read ---

/** How many greenish pixels (green clearly above red and blue) the canvas shows in the 40 x 40 box around a place of the field. */
const greenNear = (canvas: Locator, x: number, y: number) => canvas.evaluate((element, [cx, cy]) => {
  const c = element as HTMLCanvasElement;
  const data = c.getContext('2d')!.getImageData(Math.max(0, Math.round(cx! - 20)), Math.max(0, Math.round(cy! - 20)), 40, 40).data;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 1]! > data[i]! + 45 && data[i + 1]! > data[i + 2]! + 30) count += 1;
  return count;
}, [x, y] as const);

/** How many pixels of exactly this color the canvas shows (the game is drawn with the 2D canvas renderer). */
const countColor = (canvas: Locator, r: number, g: number, b: number) => canvas.evaluate((element, [cr, cg, cb]) => {
  const c = element as HTMLCanvasElement;
  const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] === cr && data[i + 1] === cg && data[i + 2] === cb) count += 1;
  return count;
}, [r, g, b] as const);
const num = async (hud: Locator, name: string) => Number((await hud.getAttribute(name)) ?? -1);

test('spitters: shooting enemies fire within seconds, their bullets are drawn, and the game goes on', async ({ page }) => {
  const { canvas, hud, errors } = await open(page, 'spitters');
  await expect(hud).toHaveAttribute('data-enemy-bullets', '0');
  await expect.poll(() => num(hud, 'data-enemy-bullets'), { timeout: 20_000, intervals: [100], message: 'no enemy bullet appeared' }).toBeGreaterThan(0);
  // theme enemy #f27b91 lightened x1.35: the color of an enemy bullet, which nothing else on screen has
  await expect.poll(() => countColor(canvas, 255, 166, 196), { timeout: 5000 }).toBeGreaterThan(8);
  // not hung: the HUD keeps changing while the player is being shot at
  const before = await hud.textContent();
  await expect.poll(async () => hud.textContent(), { timeout: 5000 }).not.toBe(before);
  expect(errors).toEqual([]);
});

test('medic: defeated enemies drop pickups, they are drawn, and taking one heals a hurt player', async ({ page }) => {
  test.setTimeout(150_000);
  const { canvas, hud, errors, frame } = await open(page, 'medic');
  await canvas.click({ position: { x: 480, y: 120 } }); // focus
  const box = (await canvas.boundingBox())!;
  const toPage = (wx: number, wy: number) => ({ x: box.x + (wx / 960) * box.width, y: box.y + (wy / 540) * box.height });
  const at = async (name: string) => ((await hud.getAttribute(name)) ?? '').split(';').filter(Boolean).map((p) => p.split(',').map(Number) as [number, number]);
  const held = new Set<string>();
  const hold = async (key: string, down: boolean) => {
    if (down && !held.has(key)) { held.add(key); await page.keyboard.down(key); }
    if (!down && held.has(key)) { held.delete(key); await page.keyboard.up(key); }
  };
  const release = async () => { for (const key of ['w', 'a', 's', 'd']) await hold(key, false); };
  const first = toPage(600, 305);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down(); // keep firing; the aim sweeps around the player
  let angle = 0;
  let sawPickup = false;
  let drawn = false;
  let healed = false;
  let hp = await num(hud, 'data-hp');
  const maxHp = hp; // the level starts at full health
  const trace: string[] = [];
  const began = Date.now();
  const deadline = began + 120_000;
  let games = 1;
  while (Date.now() < deadline && !(healed && sawPickup && drawn)) { // a pickup is only SEEN while the player has full health (otherwise it is taken at once)
    if (await frame.locator('#game-result').isVisible()) {
      // Which enemy drops something is decided by the level, and a hand-steered player is not always lucky in 15 seconds: a game that ends
      // before a pickup was seen, taken and drawn is played again (at most 4 games), the way a person would.
      trace.push(`game ${games} ended at ${((Date.now() - began) / 1000).toFixed(1)}s`);
      if (games >= 4) break;
      games += 1;
      await release();
      await page.mouse.up();
      await frame.locator('#restart-game').click();
      await expect(hud).toContainText('Máu');
      await page.mouse.down();
      hp = await num(hud, 'data-hp');
      continue;
    }
    const [player] = await at('data-player-at');
    angle += 0.2;
    if (player) { const t = toPage(player[0] + 170 * Math.cos(angle), player[1] + 170 * Math.sin(angle)); await page.mouse.move(t.x, t.y); }
    const now = await num(hud, 'data-hp');
    // health only ever goes up by taking a pickup (ignore a read that failed: -1)
    if (now >= 0 && hp >= 0 && now > hp) { healed = true; trace.push(`healed ${hp}->${now} at ${((Date.now() - began) / 1000).toFixed(1)}s`); }
    if (now >= 0) hp = now;
    const pickups = await at('data-pickup-at');
    if (pickups.length > 0) {
      sawPickup = true;
      if (!drawn) drawn = (await greenNear(canvas, pickups[0]![0], pickups[0]![1])) > 20; // the pickup's green medkit (the ground of this level is not green)
    }
    if (pickups.length > 0 && player && now < maxHp) {
      // walk to the nearest pickup while hurt
      const nearest = pickups.reduce((a, b) => (Math.hypot(a[0] - player[0], a[1] - player[1]) <= Math.hypot(b[0] - player[0], b[1] - player[1]) ? a : b));
      await hold('d', nearest[0] - player[0] > 6); await hold('a', nearest[0] - player[0] < -6);
      await hold('s', nearest[1] - player[1] > 6); await hold('w', nearest[1] - player[1] < -6);
    } else await release();
    await page.waitForTimeout(40);
  }
  await release();
  await page.mouse.up();
  const summary = `${trace.join('; ')} | last hp ${hp} of ${maxHp}, ${((Date.now() - began) / 1000).toFixed(1)}s`;
  expect(sawPickup, `no pickup was ever in the state (${summary})`).toBe(true);
  expect(drawn, 'a pickup was never drawn').toBe(true);
  expect(healed, 'taking a pickup did not raise the health').toBe(true);
  expect(errors).toEqual([]);
});

test('the level card of the hand-made levels: the shotgun says "Bắn chùm", spitters have their line, medic its drop line', async ({ page }) => {
  const card = () => page.getByRole('region', { name: 'Thông tin màn' });
  await open(page, 'shotgun-pit');
  await expect(card().locator('[data-info="weapon"]')).toContainText('Bắn chùm');
  await expect(card().locator('[data-info="weapon"]')).toContainText('6 viên mỗi phát · mỗi 1 giây · sát thương 1 mỗi viên · tầm 320');
  await expect(card().locator('[data-info="extra"]')).toHaveCount(0);
  await open(page, 'spitters');
  await expect(card().locator('[data-info="extra"]')).toHaveText(['Có quái bắn xa (né đạn của chúng)']);
  await open(page, 'medic');
  await expect(card().locator('[data-info="extra"]')).toHaveText(['Quái bị hạ có thể rơi vật phẩm hồi máu (25%)']);
  await open(page, 'arena');
  await expect(card().locator('[data-info="weapon"]')).toContainText('Bắn từng phát');
  await expect(card().locator('[data-info="extra"]')).toHaveCount(0);
});

// --- Stage 4C: the boss ---

test('boss-crusher: the warning shows when the boss appears and goes after about 2 seconds; the bar is full; the HUD says "Hạ boss"', async ({ page }) => {
  test.setTimeout(60_000);
  const { frame, hud, errors } = await open(page, 'boss-crusher');
  await expect(hud).toContainText('Hạ boss');
  await expect(hud).toHaveAttribute('data-boss-hp', '');
  const warning = frame.locator('#game-boss-warning');
  await expect(warning).toHaveCount(0); // the boss comes at 9 s, not before
  await expect(warning).toHaveText('BOSS XUẤT HIỆN!', { timeout: 20_000 });
  const seen = Date.now();
  // the bar: full at the maximum (40), and the boss is on the field
  await expect(hud).toHaveAttribute('data-boss-max', '40');
  await expect(hud).toHaveAttribute('data-boss-hp', '40');
  await expect(hud).toHaveAttribute('data-boss-phase', /move|telegraph|charge/);
  await expect(warning).toHaveCount(0, { timeout: 5000 });
  expect(Date.now() - seen).toBeLessThan(3600);
  expect(errors).toEqual([]);
});

test('boss-gunner: after the boss appears, its bullets are in the air and the game goes on', async ({ page }) => {
  test.setTimeout(60_000);
  // The first enemies of this level are few and weak, so a player who only stands there is still alive when the boss fires (first fan 2 s after it appears).
  const { hud, errors } = await open(page, 'boss-gunner');
  await expect(hud).toHaveAttribute('data-boss-max', '24', { timeout: 20_000 });
  await expect.poll(() => num(hud, 'data-enemy-bullets'), { timeout: 15_000, intervals: [100], message: 'the boss fired nothing' }).toBeGreaterThan(0);
  const before = await hud.textContent();
  await expect.poll(async () => hud.textContent(), { timeout: 5000 }).not.toBe(before);
  expect(errors).toEqual([]);
});

// (Defeating the boss by hand is not an E2E test: a real-time fight with the mouse and keys is not reliable enough to assert on.
// That a boss falls, that the game is then won, and that the expert bot wins both boss levels are unit tests:
// shooter-boss ("winning and losing with a boss") and shooter-playable ("the Stage 4C hand-made boss levels are playable").)

test('the level card of the boss levels has a boss line, and "most enemies" counts the boss', async ({ page }) => {
  const card = () => page.getByRole('region', { name: 'Thông tin màn' });
  await open(page, 'boss-crusher');
  await expect(card().locator('[data-info="goal"]')).toHaveText('Hạ boss');
  await expect(card().locator('[data-info="extra"]')).toHaveText(['Boss cuối: quái khổng lồ, lao vào bạn (máu 40)']);
  await expect(card().locator('[data-info="enemies"]')).toHaveText('16');
  await open(page, 'boss-gunner');
  await expect(card().locator('[data-info="goal"]')).toHaveText('Hạ boss');
  await expect(card().locator('[data-info="extra"]')).toHaveText(['Boss cuối: bắn đạn quạt và vòng đạn (máu 24)']);
  await expect(card().locator('[data-info="enemies"]')).toHaveText('9');
});

// --- Stage 4D: the base ---

const barBox = async (hud: Locator, name: string) => {
  const [x, y, width, height] = ((await hud.getAttribute(name)) ?? '').split(',').map(Number) as [number, number, number, number];
  return { x, y, width, height };
};

test('base-siege: the banner names the base, the HUD says "Giữ căn cứ", and the base bar is full and in the top strip, at the right', async ({ page }) => {
  const { frame, hud, errors } = await open(page, 'base-siege');
  await expect(frame.locator('#game-banner')).toContainText('MỤC TIÊU: Bảo vệ căn cứ: Sống sót 60 giây');
  await expect(hud).toContainText('Giữ căn cứ · Sống sót');
  await expect(hud).toHaveAttribute('data-base-hp', '100');
  await expect(hud).toHaveAttribute('data-base-max', '100');
  const bar = await barBox(hud, 'data-base-bar');
  expect(bar.y + bar.height).toBeLessThanOrEqual(70); // inside the HUD strip
  expect(bar.x + bar.width).toBeLessThanOrEqual(960);
  expect(bar.x + bar.width).toBeGreaterThanOrEqual(930); // at the right
  expect(bar.width).toBe(264);
  // a level without a base has none of this
  await page.goto('/?shooter=arena');
  const plain = page.frameLocator('iframe').locator('#game-hud');
  await expect(plain).toContainText('Máu');
  await expect(plain).not.toHaveAttribute('data-base-hp', /.*/);
  await expect(plain).not.toContainText('căn cứ');
  expect(errors).toEqual([]);
});

test('a game lost because the base was destroyed says so, and the player did not fall (base-fall)', async ({ page }) => {
  test.setTimeout(60_000);
  const { frame, hud, result, errors } = await open(page, 'base-fall');
  await expect(frame.locator('#game-banner')).toContainText('Bảo vệ căn cứ');
  await expect(hud).toHaveAttribute('data-base-hp', '5');
  await expect(result).toBeVisible({ timeout: 30_000 }); // the brutes reach the base after about 8 seconds
  await expect(frame.locator('#result-title')).toHaveText('Game over');
  await expect(frame.locator('#result-detail')).toContainText('Căn cứ đã bị phá.');
  await expect(hud).toHaveAttribute('data-lost-by', 'base');
  await expect(hud).toHaveAttribute('data-base-hp', '0');
  expect(await num(hud, 'data-hp')).toBeGreaterThan(0); // the player is alive
  expect(errors).toEqual([]);
});

test('a game lost by the player on a base level says "Bạn đã bị hạ", and a level without a base keeps its old sentence', async ({ page }) => {
  test.setTimeout(60_000);
  const siege = await open(page, 'base-siege');
  await expect(siege.result).toBeVisible({ timeout: 40_000 }); // standing still: the player falls first
  await expect(siege.frame.locator('#result-detail')).toContainText('Bạn đã bị hạ.');
  await expect(siege.hud).toHaveAttribute('data-lost-by', 'player');
  const smoke = await open(page, 'smoke-lose');
  await expect(smoke.result).toBeVisible({ timeout: 20_000 });
  await expect(smoke.frame.locator('#result-detail')).toContainText('Bạn đã hết máu.');
  await expect(smoke.hud).not.toHaveAttribute('data-lost-by', /.*/);
});

test('the level card of the base levels says the base goal and has a base line', async ({ page }) => {
  const card = () => page.getByRole('region', { name: 'Thông tin màn' });
  await open(page, 'base-siege');
  await expect(card().locator('[data-info="goal"]')).toHaveText('Bảo vệ căn cứ: Sống sót 60 giây');
  await expect(card().locator('[data-info="extra"]')).toHaveText(['Có căn cứ cần bảo vệ (máu 100): thua nếu căn cứ bị phá']);
  await expect(card().locator('[data-info="enemies"]')).toHaveText('31');
  await open(page, 'base-boss');
  await expect(card().locator('[data-info="goal"]')).toHaveText('Bảo vệ căn cứ: Hạ boss');
  await expect(card().locator('[data-info="extra"]')).toHaveText(['Boss cuối: quái khổng lồ, lao vào bạn (máu 30)', 'Có căn cứ cần bảo vệ (máu 50): thua nếu căn cứ bị phá']);
  await expect(card().locator('[data-info="enemies"]')).toHaveText('15');
});

test('base-boss: the base bar and the boss bar are both up and do not overlap', async ({ page }) => {
  test.setTimeout(60_000);
  const { hud, errors } = await open(page, 'base-boss');
  await expect(hud).toHaveAttribute('data-boss-max', '30', { timeout: 20_000 });
  await expect(hud).not.toHaveAttribute('data-boss-bar', '');
  const base = await barBox(hud, 'data-base-bar');
  const boss = await barBox(hud, 'data-boss-bar');
  expect(base.width).toBeGreaterThan(0);
  expect(boss.width).toBeGreaterThan(0);
  const overlap = base.x < boss.x + boss.width && boss.x < base.x + base.width && base.y < boss.y + boss.height && boss.y < base.y + base.height;
  expect(overlap, `base bar ${JSON.stringify(base)} and boss bar ${JSON.stringify(boss)}`).toBe(false);
  expect(boss.y).toBeGreaterThanOrEqual(base.y + base.height);
  expect(errors).toEqual([]);
});
