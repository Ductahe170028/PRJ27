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

test('the main page is the shooter app, with no Advanced and no Standard modes; the demo starts a game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Backend đã kết nối')).toBeVisible();
  await expect(page.getByText('TOP-DOWN SHOOTER').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Một trận sinh tồn');
  await expect(page.getByRole('button', { name: /Advanced/ })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Chế độ tạo game' })).toHaveCount(0);
  await expect(page.getByText(/GameSpec v1|2D PLATFORMER|Standard Mode/)).toHaveCount(0);
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

test('/?legacy=standard is still the previous app', async ({ page }) => {
  await page.goto('/?legacy=standard');
  await expect(page.getByText('Backend đã kết nối')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sân chơi tiếp theo');
  await expect(page.getByText('PHASE 03')).toBeVisible();
  await generate(page, 'platformer dưới ánh trăng');
  await expect(page.getByText('Game đã sẵn sàng!', { exact: true })).toBeVisible();
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible();
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
