// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App.js';
import { api, ApiError } from '../src/api.js';
import { MockGateway } from '../../api/src/clients/mock-gateway.js';

vi.mock('../src/api.js', async importOriginal => {
  const module = await importOriginal<typeof import('../src/api.js')>();
  return { ...module, api: { context: vi.fn(), search: vi.fn(), lessons: vi.fn(), prepare: vi.fn(), reopen: vi.fn() } };
});
const meta = { mode: 'mock' as const, canReopen: true, actorName: 'Test', notice: 'Dữ liệu demo.' };
describe('Tech Support UI', () => {
  beforeEach(() => {
    vi.mocked(api.context).mockResolvedValue(meta);
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
  });
  afterEach(cleanup);
  async function chooseScratch() {
    const mock = new MockGateway();
    vi.mocked(api.search).mockResolvedValue({ student: mock.students[1]!, courses: mock.courses['lms-an']!.filter(c => !c.isDeleted) });
    vi.mocked(api.lessons).mockResolvedValue({ ...(await mock.findLessons('scratch-2', 'base-an')), lessons: mock.lessons.filter(l => l.classId === 'HN-SCR-2408' && l.type !== 'CHECKPOINT' && l.lesson.type !== 'CHECKPOINT') });
    vi.mocked(api.prepare).mockResolvedValue(mock.details.get('s8-p1')!);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tìm học viên' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Tìm học viên' }));
    await screen.findByRole('heading', { name: 'Nguyễn Hoàng An' });
    fireEvent.change(screen.getByLabelText(/Khóa học Denise/), { target: { value: 'enroll-scratch' } });
    await screen.findByRole('heading', { name: 'Thiết kế trò chơi mê cung' });
    return mock;
  }
  it('validates code before contacting backend', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tìm học viên' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Mã học viên LMS'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm học viên' }));
    expect(screen.getByRole('alert')).toHaveTextContent('chữ số');
    expect(api.search).not.toHaveBeenCalled();
  });
  it('reports context authentication failure and disables searches', async () => {
    vi.mocked(api.context).mockRejectedValue(new ApiError('Cần đăng nhập qua gateway nội bộ.', 'UNAUTHENTICATED'));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cần đăng nhập');
    expect(screen.getByRole('button', { name: 'Tìm học viên' })).toBeDisabled();
  });
  it('blocks statuses, excludes quiz actions, validates note and allows cancel without a write', async () => {
    await chooseScratch();
    expect(screen.getByRole('button', { name: 'Không khả dụng Thực hành 2 · Buổi 8' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Mở lại Trắc nghiệm/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mở lại Thực hành 1 · Buổi 8' }));
    await screen.findByText('Đã kiểm tra đúng phần thực hành và trạng thái.');
    fireEvent.change(screen.getByLabelText(/Lý do mở lại/), { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: /Xác nhận mở lại/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.reopen).not.toHaveBeenCalled();
  });
  it('keeps confirmation disabled after a stale preparation response', async () => {
    await chooseScratch();
    vi.mocked(api.prepare).mockRejectedValue(new ApiError('Dữ liệu bài nộp đã thay đổi.', 'STALE_SUBMISSION'));
    fireEvent.click(screen.getByRole('button', { name: 'Mở lại Thực hành 1 · Buổi 8' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('đã thay đổi');
    expect(screen.getByRole('button', { name: /Xác nhận mở lại/ })).toBeDisabled();
    expect(api.reopen).not.toHaveBeenCalled();
  });
  it('disables real write buttons even when submission is submitted', async () => {
    vi.mocked(api.context).mockResolvedValue({ ...meta, mode: 'real', canReopen: false });
    await chooseScratch();
    expect(screen.getByRole('button', { name: 'Mở lại Thực hành 1 · Buổi 8' })).toBeDisabled();
    expect(api.prepare).not.toHaveBeenCalled();
  });
});
