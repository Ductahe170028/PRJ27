import { expect, test, type Page } from '@playwright/test';

// The main app (/): a prompt becomes a top-down shooter. The mock server answers
// the brief with a fixture chosen by a [brief:<name>] tag, and compiles for real
// (compiler, bot gate, worker), with a fixed seed.

async function useMockProvider(page: Page) {
  const toggle = page.getByRole('button', { name: /Settings/ });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(page.getByLabel('AI Provider')).toBeEnabled();
  await page.getByLabel('AI Provider').selectOption('groq');
}

async function generate(page: Page, prompt: string) {
  await page.getByLabel('Bạn muốn tạo game gì?').fill(prompt);
  await page.getByRole('button', { name: 'Generate Game' }).click();
}

const notices = (page: Page) => page.getByRole('status', { name: 'Chưa hỗ trợ và điều chỉnh' });

test('the main page is the shooter app, with no mode switch; the demo starts a game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Backend đã kết nối')).toBeVisible();
  await expect(page.getByText('TOP-DOWN SHOOTER').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Một trận sinh tồn');
  await expect(page.getByRole('group', { name: 'Chế độ tạo game' })).toHaveCount(0);
  await expect(page.getByText('WASD / mũi tên')).toBeVisible();
  await expect(notices(page)).toHaveCount(0);

  await generate(page, 'zombie');
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('canvas')).toBeVisible();
  await expect(frame.locator('#game-hud')).toContainText('Máu 5/5');
  await expect(notices(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a normal prompt through the mock provider builds a level and shows no notices', async ({ page }) => {
  await page.goto('/');
  await useMockProvider(page);
  await generate(page, 'zombie thành phố, sống sót 60 giây');
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('canvas')).toBeVisible();
  await expect(frame.locator('#game-hud')).toContainText('Máu 5/5');
  await expect(frame.locator('#game-hud')).toContainText('Sống sót');
  await expect(notices(page)).toHaveCount(0);
});

test('what the engine cannot do is listed, and the game still runs', async ({ page }) => {
  await page.goto('/');
  await useMockProvider(page);
  await generate(page, 'bắn zombie, có boss cuối và hồi máu [brief:unsupported]');
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible();
  const block = notices(page);
  await expect(block).toBeVisible();
  await expect(block.getByRole('heading', { name: 'Chưa hỗ trợ / điều chỉnh' })).toBeVisible();
  await expect(block.getByRole('listitem')).toContainText(['Chưa có boss cuối', 'Chưa có vật phẩm hồi máu']);
  // the model listed both; the engine's own sentences would only repeat them
  await expect(block.getByRole('listitem')).toHaveCount(2);
});

test('the engine adds its own notice when the model forgot to list an unsupported request', async ({ page }) => {
  await page.goto('/');
  await useMockProvider(page);
  await generate(page, 'zombie nhưng phải bảo vệ căn cứ, hết đạn thì nạp đạn');
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  const items = notices(page).getByRole('listitem');
  await expect(items).toContainText(['Chưa hỗ trợ: bảo vệ căn cứ. Màn chơi chỉ có sống sót hoặc hạ quái.', 'Chưa hỗ trợ: giới hạn đạn và nạp đạn. Đạn không giới hạn, có hồi chiêu.']);
});

test('escorting someone and a prompt with no enemies get their own fixed sentences, never the prompt text', async ({ page }) => {
  await page.goto('/');
  await useMockProvider(page);
  await generate(page, 'hộ tống công chúa, không có quái nhưng hạ 50 quái');
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  const items = notices(page).getByRole('listitem');
  await expect(items).toHaveText([
    'Chưa hỗ trợ: màn không có quái. Màn chơi luôn có quái xuất hiện.',
    'Chưa hỗ trợ: bảo vệ hoặc hộ tống nhân vật khác. Game chỉ có một người chơi.',
  ]);
});

test('an invalid choice by the model shows a specific reason and no game', async ({ page }) => {
  await page.goto('/');
  await useMockProvider(page);
  await generate(page, 'cướp biển [brief:bad-enum]');
  const status = page.getByRole('alert').filter({ hasText: 'Lý do' });
  await expect(status).toContainText('Lý do: Mô hình chọn một giá trị không hỗ trợ cho theme.');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(notices(page)).toHaveCount(0);
});

test('an answer that is not JSON shows an error and no game', async ({ page }) => {
  await page.goto('/');
  await useMockProvider(page);
  await generate(page, 'xin chào [brief:bad-json]');
  await expect(page.getByRole('alert').filter({ hasText: 'không trả về JSON hợp lệ' })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('a running game is not reported as "not started" 15 seconds later, even after the page re-renders', async ({ page }) => {
  // The preview used to start a 15 s "did it start?" timer again every time the parent
  // re-rendered with a new `source` object (and the iframe never answers a second time),
  // so a game that was running disappeared with "Game chưa khởi chạy sau 15 giây".
  // The wait must therefore be REAL and longer than 15 s: nothing shorter can show it.
  test.setTimeout(75_000);
  await page.goto('/');
  await generate(page, 'zombie');
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  await expect(page.getByText('Đang chạy', { exact: true })).toBeVisible();
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('canvas')).toBeVisible();
  // Typing re-renders the app (an unstable `source` would restart the timer here too).
  await page.getByLabel('Bạn muốn tạo game gì?').pressSequentially(' thêm vài chữ');
  await page.waitForTimeout(17_000);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(/chưa khởi chạy sau 15 giây/)).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.getByText('Đang chạy', { exact: true })).toBeVisible();
  await expect(frame.locator('#game-hud')).toContainText('Máu');
});

// --- Stage 4A part 1: the player is told what to do ---

const infoCard = (page: Page) => page.getByRole('region', { name: 'Thông tin màn' });
const field = (page: Page, name: string) => infoCard(page).locator(`[data-info="${name}"]`);

test('the level card shows the goal and the gun of a survive level, read from the level itself', async ({ page }) => {
  await page.goto('/');
  await expect(infoCard(page)).toHaveCount(0);
  await useMockProvider(page);
  await generate(page, 'zombie thành phố, sống sót 60 giây');
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  await expect(infoCard(page)).toBeVisible();
  await expect(infoCard(page).getByRole('heading', { name: 'Thông tin màn' })).toBeVisible();
  await expect(field(page, 'goal')).toHaveText('Sống sót 60 giây');
  await expect(field(page, 'health')).toHaveText('5');
  await expect(field(page, 'enemies')).toHaveText(/^[1-9]\d*$/);
  await expect(field(page, 'weapon')).toContainText('Bắn từng phát');
  await expect(field(page, 'weapon')).toContainText('mỗi 0,3 giây một phát · sát thương 1 · tầm 600');
  // the HUD in the game says the same goal, with progress in one piece
  await expect(page.frameLocator('iframe').locator('#game-hud')).toContainText(/Sống sót \d+\/60s/);
});

test('the level card shows the goal and the gun of a kill level, and sits above the notices', async ({ page }) => {
  await page.goto('/');
  await useMockProvider(page);
  await generate(page, 'bắn zombie, có boss cuối và hồi máu [brief:unsupported]');
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  await expect(field(page, 'goal')).toHaveText('Hạ 20 quái');
  await expect(field(page, 'health')).toHaveText('5');
  await expect(field(page, 'weapon')).toContainText('Bắn liên tục');
  await expect(field(page, 'weapon')).toContainText('mỗi 0,15 giây một phát · sát thương 1 · tầm 500');
  const card = (await infoCard(page).boundingBox())!;
  const list = (await notices(page).boundingBox())!;
  expect(card.y).toBeLessThan(list.y);
  const hud = page.frameLocator('iframe').locator('#game-hud');
  await expect(hud).toContainText(/Hạ \d+\/20/);
  await expect(hud).not.toContainText('Mục tiêu');
});

test('the goal banner is shown at the start for about 3 seconds while the game keeps running, and again after a restart', async ({ page }) => {
  await page.goto('/');
  await useMockProvider(page);
  await generate(page, 'zombie thành phố, sống sót 60 giây');
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  const frame = page.frameLocator('iframe');
  const banner = frame.locator('#game-banner');
  await expect(banner).toContainText('MỤC TIÊU: Sống sót 60 giây');
  await expect(banner).toContainText('WASD di chuyển · chuột ngắm và bắn · R chơi lại');
  const seen = Date.now();
  // the simulation is not paused behind the banner: the clock in the HUD moves while it is up
  await expect(frame.locator('#game-hud')).toContainText(/Sống sót [1-9]\/60s/);
  await expect(banner).toHaveCount(0, { timeout: 4000 });
  expect(Date.now() - seen).toBeLessThan(3600);
  await expect(frame.locator('#game-hud')).toContainText('Máu');
  // R plays again, and the banner comes back
  await frame.locator('canvas').click({ position: { x: 100, y: 120 } });
  await page.keyboard.press('r');
  await expect(banner).toContainText('MỤC TIÊU: Sống sót 60 giây');
  await expect(banner).toHaveCount(0, { timeout: 4000 });
});

test('a kill level names its goal on the banner', async ({ page }) => {
  await page.goto('/');
  await useMockProvider(page);
  await generate(page, 'bắn zombie, có boss cuối và hồi máu [brief:unsupported]');
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  await expect(page.frameLocator('iframe').locator('#game-banner')).toContainText('MỤC TIÊU: Hạ 20 quái');
});

// --- Stage 4B: the card of a generated level with the new mechanics ---

test('a brief with the shotgun, spitters and health drops: the card says so, and nothing is reported as unsupported', async ({ page }) => {
  await page.goto('/');
  await useMockProvider(page);
  await generate(page, 'bắn tỉa sa mạc, quái cung thủ, rơi hộp máu [brief:shotgun-spitter]');
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  await expect(field(page, 'weapon')).toContainText('Bắn chùm');
  await expect(field(page, 'weapon')).toContainText('6 viên mỗi phát · mỗi 1 giây · sát thương 1 mỗi viên · tầm 320');
  await expect(infoCard(page).locator('[data-info="extra"]')).toHaveText(['Có quái bắn xa (né đạn của chúng)', 'Quái bị hạ có thể rơi vật phẩm hồi máu (12%)']);
  await expect(notices(page)).toHaveCount(0);
  await expect(page.frameLocator('iframe').locator('#game-hud')).toHaveAttribute('data-pickups', '0');
});

// --- Stage 4C: a generated level with a boss ---

test('a brief with a boss: the banner, the card and the notice all say "Hạ boss", and the boss bar is not there until it comes', async ({ page }) => {
  await page.goto('/');
  await useMockProvider(page);
  await generate(page, 'bảo vệ căn cứ có boss cuối to khổng lồ [brief:boss]');
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#game-banner')).toContainText('MỤC TIÊU: Hạ boss');
  await expect(field(page, 'goal')).toHaveText('Hạ boss');
  await expect(infoCard(page).locator('[data-info="extra"]')).toHaveText([/^Boss cuối: quái khổng lồ, lao vào bạn \(máu \d+\)$/]);
  await expect(notices(page).getByRole('listitem').filter({ hasText: 'Màn có boss: thắng bằng cách hạ boss.' })).toHaveCount(1);
  await expect(frame.locator('#game-hud')).toContainText('Hạ boss');
  await expect(frame.locator('#game-hud')).toHaveAttribute('data-boss-hp', '');
  // one boss is supported: no "unsupported boss" sentence
  await expect(notices(page).getByRole('listitem').filter({ hasText: 'Chưa hỗ trợ: boss' })).toHaveCount(0);
});

// --- What the removed specs (ai.spec.ts, creator.spec.ts) checked about the shared parts of the page, now on the main app ---

async function choose(page: Page, provider: 'gemini' | 'groq') {
  const toggle = page.getByRole('button', { name: /Settings/ });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(page.getByLabel('AI Provider')).toBeEnabled();
  await page.getByLabel('AI Provider').selectOption(provider);
}

test('settings makes no hidden provider calls and persists only provider/model selection', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', (request) => { if (request.method() === 'POST') calls.push(request.url()); });
  await page.goto('/');
  await choose(page, 'gemini');
  expect(calls).toEqual([]);
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('auto');
  await expect(page.getByLabel('Model', { exact: true }).locator('option')).toHaveText([
    'Tự động — Gemini 3.5 Flash-Lite (khuyến nghị)', 'Gemini 3.5 Flash-Lite (gemini-3.5-flash-lite)',
    'Gemini 3.6 Flash (gemini-3.6-flash)', 'Gemini 3.8 Flash (gemini-3.8-flash)',
  ]);
  await expect(page.getByRole('list', { name: 'Tình trạng cấu hình provider' })).toContainText('Google Gemini');
  let connection = page.waitForRequest((request) => request.url().includes('/api/ai/test-connection'));
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  expect((await connection).postDataJSON()).toEqual({ providerId: 'gemini' });
  await expect(page.getByText(/Đã kết nối provider và tìm thấy model/)).toBeVisible();
  expect(calls).toHaveLength(1);
  await choose(page, 'groq');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('auto');
  await page.getByLabel('Model', { exact: true }).selectOption('openai/gpt-oss-120b');
  connection = page.waitForRequest((request) => request.url().includes('/api/ai/test-connection'));
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  expect((await connection).postDataJSON()).toEqual({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' });
  await expect(page.getByText(/Đã kết nối provider và tìm thấy model/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Settings/ }).click();
  await expect(page.getByLabel('AI Provider')).toHaveValue('groq');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('openai/gpt-oss-120b');
  const stored = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  expect(stored).toEqual({ 'game-creator.provider.v1': JSON.stringify({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' }) });
  expect(JSON.stringify(stored)).not.toMatch(/key/i);
  expect(calls).toHaveLength(2);
});

test('flags a saved retired model and generates with the server default only after the user picks it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game-creator.provider.v1', JSON.stringify({ providerId: 'groq', modelId: 'llama-3.3-70b-versatile' })));
  await page.goto('/');
  await expect(page.locator('.settings-summary')).toContainText('Unavailable');
  await page.getByLabel('Bạn muốn tạo game gì?').fill('zombie thành phố');
  await expect(page.getByRole('button', { name: 'Generate Game' })).toBeDisabled();
  await expect(page.getByText(/Model đã lưu \(llama-3\.3-70b-versatile\) không còn trong allowlist/).first()).toBeVisible();
  await choose(page, 'groq');
  await page.getByLabel('Model', { exact: true }).selectOption('auto');
  const request = page.waitForRequest((item) => item.url().includes('/api/shooter/generate'));
  await generate(page, 'zombie thành phố');
  expect((await request).postDataJSON()).toEqual({ providerId: 'groq', prompt: 'zombie thành phố' });
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
});

test('a demo choice saved under the old id (the platformer) is read as the demo, and the demo sends its own id', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('game-creator.provider.v1', JSON.stringify({ providerId: 'demo', modelId: 'platformer-v1' })));
  await page.goto('/');
  await expect(page.locator('.settings-summary')).toContainText('Đấu trường');
  await expect(page.locator('.settings-summary')).toContainText('Sẵn sàng');
  await expect(page.getByText('Demo mode')).toBeVisible();
  await page.getByRole('button', { name: /Settings/ }).click();
  await expect(page.getByLabel('AI Provider')).toHaveValue('demo');
  await expect(page.getByLabel('Model', { exact: true }).locator('option')).toHaveText(['Đấu trường (demo)']);
  const request = page.waitForRequest((item) => item.url().includes('/api/shooter/generate'));
  await generate(page, 'zombie');
  expect((await request).postDataJSON()).toEqual({ providerId: 'demo', modelId: 'shooter-arena', prompt: 'zombie' });
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
});

test('quota errors are visible without provider fallback or retries', async ({ page }) => {
  let requests = 0;
  page.on('request', (request) => { if (request.url().includes('/api/shooter/generate')) requests += 1; });
  await page.goto('/'); await choose(page, 'gemini');
  await generate(page, '[quota]');
  await expect(page.getByText('Provider đã hết quota. Hãy thử lại sau. Có thể thử lại sau khoảng 60 giây.')).toBeVisible();
  await expect(page.locator('.error-code')).toHaveText('Mã lỗi: rate_limit');
  expect(requests).toBe(1);
  await expect(page.getByLabel('AI Provider')).toHaveValue('gemini');
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('unconfigured provider stays unavailable after reload', async ({ page }) => {
  await page.route('**/api/ai/providers', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ providers: [
    { id: 'gemini', name: 'Google Gemini', available: false, reason: 'missing_key', defaultModelId: 'gemini-3.5-flash-lite', models: [] },
    { id: 'groq', name: 'Groq', available: false, reason: 'missing_key', defaultModelId: 'openai/gpt-oss-20b', models: [] },
  ] }) }));
  await page.goto('/'); await choose(page, 'gemini');
  await page.getByLabel('Bạn muốn tạo game gì?').fill('zombie thành phố');
  await expect(page.getByRole('button', { name: 'Generate Game' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  await expect(page.locator('.settings-info').filter({ hasText: 'Chưa có API key. Thêm GEMINI_API_KEY' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Tình trạng cấu hình provider' })).toContainText('GROQ_API_KEY');
  await page.reload();
  await page.getByRole('button', { name: /Settings/ }).click();
  await expect(page.getByLabel('AI Provider')).toHaveValue('gemini');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('auto');
});

test('backend 500 responses without a structured body show a readable error', async ({ page }) => {
  await page.route('**/api/shooter/generate', (route) => route.fulfill({ status: 502, contentType: 'text/plain', body: 'bad gateway' }));
  await page.goto('/'); await choose(page, 'gemini');
  await generate(page, 'zombie thành phố');
  await expect(page.getByText('Backend trả về lỗi HTTP 502. Hãy kiểm tra server và thử lại.')).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('shows the field that failed validation, as the server sent it', async ({ page }) => {
  await page.goto('/');
  await useMockProvider(page);
  const response = page.waitForResponse((item) => item.url().includes('/api/shooter/generate'));
  await generate(page, 'cướp biển [brief:bad-enum]');
  const body = await (await response).json();
  expect(body.error.code).toBe('invalid_brief');
  const theme = body.error.issues.find((issue: { path?: string }) => issue.path === 'theme');
  expect(theme).toMatchObject({ path: 'theme', code: expect.any(String), message: expect.any(String) });
  await expect(page.getByRole('list', { name: 'Chi tiết lỗi' })).toContainText('theme');
  await expect(page.locator('.error-code')).toHaveText('Mã lỗi: invalid_brief');
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('shows loading, reports a network error, and can recover', async ({ page }) => {
  await page.goto('/');
  let releaseRequest = () => {};
  const gate = new Promise<void>((resolve) => { releaseRequest = resolve; });
  await page.route('**/api/shooter/generate', async (route) => {
    await gate;
    await route.abort('failed');
  });
  await generate(page, 'zombie thành phố');
  await expect(page.getByRole('heading', { name: 'Đang dựng màn chơi…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đang tạo game…' })).toBeDisabled();
  releaseRequest();
  await expect(page.getByText('Chưa thể khởi chạy game', { exact: true })).toBeVisible();
  await expect(page.getByText(/Không kết nối được backend\. Hãy chạy/)).toBeVisible();
  await page.unroute('**/api/shooter/generate');
  await page.getByRole('button', { name: 'Generate Game' }).click();
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
});

test('keeps a pasted prompt over 2000 characters and sends an in-limit prompt verbatim', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Backend đã kết nối')).toBeVisible();
  const pasted = 'A'.repeat(2496);
  const box = page.getByLabel('Bạn muốn tạo game gì?');
  expect(await box.evaluate((element) => (element as HTMLTextAreaElement).maxLength)).toBe(-1);
  await box.fill(pasted);
  await expect(box).toHaveValue(pasted);
  await expect(page.locator('.input-bottom')).toContainText('2.496 / 2.000');
  await expect(page.locator('#prompt-error')).toContainText('2.496');
  await expect(page.getByRole('button', { name: 'Generate Game' })).toBeDisabled();
  let sent = 0;
  page.on('request', (request) => { if (request.url().includes('/api/shooter/generate')) sent += 1; });
  await page.locator('.prompt-panel form').evaluate((form) => { (form as HTMLFormElement).requestSubmit(); });
  expect(sent).toBe(0);
  await expect(box).toHaveValue(pasted);

  const valid = '  Zombie thành phố, sống sót 60 giây  ';
  const request = page.waitForRequest((item) => item.url().includes('/api/shooter/generate') && item.method() === 'POST');
  await box.fill(valid);
  await expect(page.locator('#prompt-error')).toBeEmpty();
  await expect(page.getByRole('button', { name: 'Generate Game' })).toBeEnabled();
  await page.getByRole('button', { name: 'Generate Game' }).click();
  expect((await request).postDataJSON()).toMatchObject({ prompt: valid });
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
  await page.route('**/api/shooter/generate', (route) => route.fulfill({
    status: 201, contentType: 'application/json', body: JSON.stringify({ data: { code: 'alert(1)' } }),
  }));
  await page.goto('/');
  await generate(page, 'zombie thành phố');
  await expect(page.getByText('Dữ liệu game không hợp lệ. Hãy kiểm tra backend và thử lại.')).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('works on a narrow touch viewport without horizontal overflow', async ({ page }) => {
    await page.goto('/');
    await generate(page, 'zombie');
    await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
    await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await page.screenshot({ path: 'test-results/workspace-mobile.png', fullPage: true });
  });
});
