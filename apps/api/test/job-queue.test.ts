import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIError } from '../src/providers/errors.js';
import { JobQueue, timeoutError, type JobHandle, type JobQueueOptions } from '../src/services/job-queue.js';

const options = (overrides: Partial<JobQueueOptions> = {}): JobQueueOptions => ({ concurrency: 1, maxQueue: 2, runTimeoutMs: 10_000, maxWaitMs: 5_000, ...overrides });
const never = () => new AbortController();
afterEach(() => { vi.useRealTimers(); });

describe('JobQueue admission', () => {
  it('rejects with 429 and Retry-After when concurrency and queue are full, before anything starts', () => {
    const queue = new JobQueue(options({ maxQueue: 1 }));
    queue.admit('a'); queue.admit('b');
    expect(() => queue.admit('c')).toThrowError(expect.objectContaining({ code: 'rate_limit', status: 429, retryAfterSeconds: 10 }));
    expect(queue.stats()).toEqual({ running: 1, waiting: 1, closed: false });
  });

  it('with maxQueue 0 behaves like a single-job lock (the legacy behaviour)', () => {
    const queue = new JobQueue(options({ maxQueue: 0 }));
    const first = queue.admit('a');
    expect(() => queue.admit('b')).toThrowError(/đang xử lý một game/);
    first.release();
    expect(() => queue.admit('b')).not.toThrow();
  });

  it('limits running plus waiting jobs per owner so one address cannot fill the queue', () => {
    const queue = new JobQueue(options({ maxQueue: 5, maxPerOwner: 2 }));
    queue.admit('same'); queue.admit('same');
    expect(() => queue.admit('same')).toThrowError(expect.objectContaining({ code: 'rate_limit', status: 429 }));
    expect(() => queue.admit('other')).not.toThrow();
  });

  it('never holds more than concurrency + maxQueue jobs however many arrive', () => {
    const queue = new JobQueue(options({ concurrency: 2, maxQueue: 3 }));
    let rejected = 0;
    for (let i = 0; i < 500; i += 1) { try { queue.admit(`o${i}`); } catch { rejected += 1; } }
    expect(queue.stats()).toEqual({ running: 2, waiting: 3, closed: false });
    expect(rejected).toBe(495);
  });

  it('validates its configuration', () => {
    expect(() => new JobQueue(options({ concurrency: 0 }))).toThrow();
    expect(() => new JobQueue(options({ maxQueue: -1 }))).toThrow();
    expect(() => new JobQueue(options({ runTimeoutMs: 0 }))).toThrow();
  });
});

describe('JobQueue concurrency and ordering', () => {
  it('runs at most `concurrency` jobs at once and in FIFO order', async () => {
    const queue = new JobQueue(options({ concurrency: 2, maxQueue: 10 }));
    const order: number[] = []; let live = 0; let peak = 0;
    const work = async (id: number, handle: JobHandle) => {
      await handle.start(never().signal);
      live += 1; peak = Math.max(peak, live); order.push(id);
      await new Promise((r) => setTimeout(r, 15));
      live -= 1; handle.release();
    };
    await Promise.all(Array.from({ length: 8 }, (_, i) => work(i, queue.admit(`o${i}`))));
    expect(peak).toBe(2);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(queue.stats()).toEqual({ running: 0, waiting: 0, closed: false });
  });

  it('reports each place in line once, and updates it as the line moves', async () => {
    const queue = new JobQueue(options({ maxQueue: 3 }));
    const first = queue.admit('a'); await first.start(never().signal);
    const places: number[] = [];
    const second = queue.admit('b'); const third = queue.admit('c'); const thirdPlaces: number[] = [];
    const secondStarted = second.start(never().signal, (place) => places.push(place));
    third.start(never().signal, (place) => thirdPlaces.push(place)).catch(() => {});
    expect(places).toEqual([1]); expect(thirdPlaces).toEqual([2]);
    first.release(); await secondStarted;
    expect(thirdPlaces).toEqual([2, 1]);
    second.release(); third.release();
  });
});

describe('JobQueue timeouts, cancel and cleanup', () => {
  it('aborts a running job with a timeout AIError and frees the slot after release', async () => {
    vi.useFakeTimers();
    const queue = new JobQueue(options({ runTimeoutMs: 4_000 }));
    const handle = queue.admit('a'); const running = await handle.start(never().signal);
    await vi.advanceTimersByTimeAsync(3_999); expect(running.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(running.signal.aborted).toBe(true);
    expect(running.signal.reason).toMatchObject({ code: 'timeout', status: 504, message: 'Advanced đã hết thời hạn 4 giây.' });
    handle.release();
    expect(queue.stats().running).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('formats the default 4 minute deadline exactly as before the queue existed', () => {
    expect(timeoutError(240_000).message).toBe('Advanced đã hết thời hạn 4 phút.');
  });

  it('drops a job that waited too long with 429 and frees its place', async () => {
    vi.useFakeTimers();
    const queue = new JobQueue(options({ maxWaitMs: 3_000 }));
    const first = queue.admit('a'); await first.start(never().signal);
    const waiting = queue.admit('b'); const result = waiting.start(never().signal);
    const caught = result.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await caught).toMatchObject({ code: 'rate_limit', status: 429 });
    expect(queue.stats()).toEqual({ running: 1, waiting: 0, closed: false });
    first.release();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a waiting job when the client disconnects and gives its place away', async () => {
    const queue = new JobQueue(options());
    const first = queue.admit('a'); await first.start(never().signal);
    const gone = never(); const waiting = queue.admit('b');
    const result = waiting.start(gone.signal).catch((error: unknown) => error);
    const behind = queue.admit('c'); const behindPlaces: number[] = [];
    const behindStarted = behind.start(never().signal, (place) => behindPlaces.push(place));
    gone.abort(new AIError('cancelled', 'Client đã ngắt kết nối.', 499));
    expect(await result).toMatchObject({ code: 'cancelled' });
    expect(queue.stats().waiting).toBe(1);
    first.release(); await behindStarted;
    expect(queue.stats()).toEqual({ running: 1, waiting: 0, closed: false });
    behind.release();
  });

  it('does not start a job whose client is already gone', async () => {
    const queue = new JobQueue(options());
    const gone = never(); gone.abort(new AIError('cancelled', 'x', 499));
    await expect(queue.admit('a').start(gone.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(queue.stats()).toEqual({ running: 0, waiting: 0, closed: false });
  });

  it('release() is idempotent and a stale handle cannot free another job', async () => {
    const queue = new JobQueue(options({ maxQueue: 0 }));
    const old = queue.admit('a'); await old.start(never().signal);
    old.release();
    const current = queue.admit('b'); await current.start(never().signal);
    old.release(); old.release();
    expect(queue.stats().running).toBe(1);
    current.release();
  });

  it('removes every listener and timer from the caller signal', async () => {
    vi.useFakeTimers();
    const queue = new JobQueue(options());
    const controller = never(); const handle = queue.admit('a');
    await handle.start(controller.signal); handle.release();
    controller.abort();
    expect(vi.getTimerCount()).toBe(0);
    expect(queue.stats().running).toBe(0);
  });
});

describe('JobQueue shutdown', () => {
  it('rejects new jobs, fails waiting ones, aborts running ones and ends idle', async () => {
    vi.useFakeTimers();
    const queue = new JobQueue(options({ maxQueue: 2 }));
    const running = queue.admit('a'); const live = await running.start(never().signal);
    const waiting = queue.admit('b'); const waited = waiting.start(never().signal).catch((error: unknown) => error);
    const stopping = queue.shutdown(0);
    expect(await waited).toMatchObject({ code: 'shutting_down', status: 503 });
    expect(() => queue.admit('c')).toThrowError(expect.objectContaining({ code: 'shutting_down', status: 503 }));
    expect(live.signal.aborted).toBe(true);
    expect(live.signal.reason).toMatchObject({ code: 'shutting_down' });
    running.release();
    await stopping;
    expect(queue.stats()).toEqual({ running: 0, waiting: 0, closed: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives running jobs the grace period to finish before aborting them', async () => {
    vi.useFakeTimers();
    const queue = new JobQueue(options());
    const handle = queue.admit('a'); const live = await handle.start(never().signal);
    const stopping = queue.shutdown(1_000);
    await vi.advanceTimersByTimeAsync(999); expect(live.signal.aborted).toBe(false);
    handle.release(); await stopping;
    expect(live.signal.aborted).toBe(false);
  });
});
