import { EventEmitter, getEventListeners } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const workers = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('node:worker_threads', () => ({ Worker: class { constructor() { return workers.create(); } } }));
import { IsolatedCodeValidator } from '../src/agent/isolated-validator.js';

function harness() {
  let terminated!: (code: number) => void;
  const termination = new Promise<number>((resolve) => { terminated = resolve; });
  const worker = Object.assign(new EventEmitter(), { terminate: vi.fn(() => termination) });
  workers.create.mockReturnValue(worker);
  const controller = new AbortController();
  const result = new IsolatedCodeValidator().validate('source', controller.signal);
  return { worker, controller, result, terminated };
}
afterEach(() => { vi.useRealTimers(); workers.create.mockReset(); });

describe('validator worker lifecycle', () => {
  it('waits for termination before returning compiled code', async () => {
    const h = harness();
    const settled = vi.fn(); void h.result.then(settled);
    h.worker.emit('message', { javascript: 'compiled', errors: [] });
    await Promise.resolve();
    expect(h.worker.terminate).toHaveBeenCalledOnce();
    expect(settled).not.toHaveBeenCalled();
    h.terminated(0);
    await expect(h.result).resolves.toEqual({ javascript: 'compiled', errors: [] });
    expect(getEventListeners(h.controller.signal, 'abort')).toHaveLength(0);
    expect(h.worker.eventNames()).toEqual([]);
  });
  it('cancels once even if the worker emits a late result and exit', async () => {
    const h = harness(); h.controller.abort();
    h.worker.emit('message', { javascript: 'late', errors: [] });
    h.worker.emit('exit', 1); h.terminated(1);
    await expect(h.result).resolves.toEqual({ errors: ['Validation đã bị hủy.'] });
    expect(h.worker.terminate).toHaveBeenCalledOnce();
    expect(h.worker.eventNames()).toEqual([]);
  });
  it('terminates a compiler that exceeds its time budget', async () => {
    vi.useFakeTimers();
    const h = harness();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.worker.terminate).toHaveBeenCalledOnce();
    h.terminated(1);
    expect((await h.result).errors.join()).toContain('5 giây');
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(h.controller.signal, 'abort')).toHaveLength(0);
  });
  it('does not launch a worker for cancelled work', async () => {
    const controller = new AbortController(); controller.abort();
    expect((await new IsolatedCodeValidator().validate('source', controller.signal)).errors).toHaveLength(1);
    expect(workers.create).not.toHaveBeenCalled();
  });
});
