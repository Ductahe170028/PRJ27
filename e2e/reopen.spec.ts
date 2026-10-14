import { expect, test } from '@playwright/test';

test('full mock flow reopens only chosen part, handles file warning and verifies REDO', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('/');
  await expect(page.getByText('Mock mode', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tìm học viên', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nguyễn Hoàng An' })).toBeVisible();
  await page.getByLabel('Khóa học Denise').selectOption('enroll-scratch');
  await expect(page.locator('.homework-card')).toHaveCount(5);
  await expect(page.getByText('Checkpoint giữa khóa')).toHaveCount(0);
  await expect(page.getByText('Bài tập thuộc lớp khác')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/qa-desktop.png', fullPage: true });
  await expect(page.getByRole('button', { name: 'Không khả dụng Thực hành 2 · Buổi 8', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Mở lại Thực hành 1 · Buổi 8', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Nguyễn Hoàng An')).toBeVisible();
  await expect(dialog.getByText('Đã kiểm tra đúng phần thực hành và trạng thái.')).toBeVisible();
  await page.screenshot({ path: 'test-results/qa-confirmation.png' });
  await expect(dialog.getByLabel('Lý do mở lại')).toHaveValue('Mở lại do học viên lỡ nộp bài khi chưa hoàn thành');
  await dialog.getByLabel('Lý do mở lại').fill('');
  await expect(dialog.getByRole('button', { name: 'Xác nhận mở lại' })).toBeDisabled();
  await dialog.getByLabel('Lý do mở lại').fill('Học viên lỡ nộp phần 1, cho phép tiếp tục.');
  await dialog.getByRole('button', { name: 'Xác nhận mở lại' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Đã xác minh kết quả' })).toBeVisible();
  const lesson8 = page.locator('.homework-card').filter({ hasText: 'Thiết kế trò chơi mê cung' });
  await expect(lesson8.getByText('Yêu cầu làm lại', { exact: true })).toBeVisible();
  await expect(lesson8.getByText('Chưa nộp', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Không khả dụng Thực hành 1 · Buổi 8', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Mở lại Thực hành 2 · Buổi 9', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Lưu ý khi nộp file')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mở lại Thực hành 2 · Buổi 9', exact: true })).toBeEnabled();
});

test('empty and error states plus completed course selection work on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Mã học viên LMS').fill('99999999');
  await page.getByRole('button', { name: 'Tìm học viên', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('trùng chính xác');
  await page.getByLabel('Mã học viên LMS').fill('26000002');
  await page.getByRole('button', { name: 'Tìm học viên', exact: true }).click();
  await expect(page.getByText('Học viên chưa có khóa học Denise để lựa chọn.')).toBeVisible();
  await page.getByLabel('Mã học viên LMS').fill('26009543');
  await page.getByRole('button', { name: 'Tìm học viên', exact: true }).click();
  await page.getByLabel('Khóa học Denise').selectOption('enroll-python');
  await expect(page.getByRole('heading', { name: 'Chưa có bài tập về nhà' })).toBeVisible();
  await page.getByLabel('Khóa học Denise').selectOption('enroll-scratch-old');
  await expect(page.locator('.homework-card')).toHaveCount(1);
  await expect(page.getByText('Bài tập thuộc lớp khác')).toBeVisible();
  await page.screenshot({ path: 'test-results/qa-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('uncertain write shows warning, reads again, blocks reissue and never auto retries', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/reopen', async route => {
    writes++;
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'VERIFICATION_FAILED', message: 'Chưa xác định được kết quả mở lại. Không gửi lại thao tác.', uncertain: true } }) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Tìm học viên', exact: true }).click();
  await page.getByLabel('Khóa học Denise').selectOption('enroll-scratch');
  await page.getByRole('button', { name: 'Mở lại Thực hành 1 · Buổi 10', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Đã kiểm tra đúng phần thực hành và trạng thái.')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận mở lại' }).click();
  await expect(page.getByRole('alert')).toContainText('Chưa xác định được kết quả');
  await expect(page.getByRole('button', { name: 'Mở lại Thực hành 1 · Buổi 10', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Tải lại', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mở lại Thực hành 1 · Buổi 10', exact: true })).toBeDisabled();
  expect(writes).toBe(1);
});
