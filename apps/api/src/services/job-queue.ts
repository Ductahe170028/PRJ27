import { AIError } from '../providers/errors.js';

export interface JobQueueOptions {
  /** Jobs allowed to run at the same time. */
  concurrency: number;
  /** Jobs allowed to wait for a slot. 0 means no queue: a busy server rejects. */
  maxQueue: number;
  /** Longest a job may run after it starts. */
  runTimeoutMs: number;
  /** Longest a job may wait for a slot. */
  maxWaitMs?: number;
  /** Running plus waiting jobs for one owner (a client address key). */
  maxPerOwner?: number;
}

export interface JobStats { running: number; waiting: number; closed: boolean }

/** Returned once a job owns a slot. `signal` aborts with an AIError when the job
 * times out or the server shuts down. Client cancellation is the caller's own
 * signal and is never routed through here. */
export interface RunningJob { readonly signal: AbortSignal }

export interface JobHandle {
  /** Resolves when the job owns a slot; rejects if it is cancelled, waits too
   * long or the queue shuts down. `onWaiting` gets the 1-based place in line. */
  start(cancel: AbortSignal, onWaiting?: (place: number) => void): Promise<RunningJob>;
  /** Idempotent. Frees the slot or the place in line and clears every timer. */
  release(): void;
}

type JobState = 'waiting' | 'running' | 'released';

class Job implements JobHandle {
  state: JobState = 'waiting';
  private run: AbortController | undefined;
  private runTimer: ReturnType<typeof setTimeout> | undefined;
  private waitTimer: ReturnType<typeof setTimeout> | undefined;
  private pending: { resolve: (job: RunningJob) => void; reject: (reason: unknown) => void; cancel: AbortSignal; onCancel: () => void; onWaiting: ((place: number) => void) | undefined } | undefined;
  private lastPlace = 0;

  constructor(readonly owner: string, private readonly queue: JobQueue) {}

  /** Called by the queue. */
  armWait(ms: number): void {
    this.waitTimer = setTimeout(() => this.queue.expire(this), ms);
  }
  grant(): void {
    this.state = 'running';
    clearTimeout(this.waitTimer);
    this.waitTimer = undefined;
    if (this.pending) this.begin();
  }
  place(place: number): void {
    // Remember a place only once the caller can hear it (start() was called).
    if (this.pending && place !== this.lastPlace) { this.lastPlace = place; this.pending.onWaiting?.(place); }
  }
  fail(error: unknown): void {
    this.settle()?.reject(error);
  }
  abortRun(error: AIError): void { this.run?.abort(error); }

  start(cancel: AbortSignal, onWaiting?: (place: number) => void): Promise<RunningJob> {
    if (this.state === 'released') return Promise.reject(new AIError('cancelled', 'Yêu cầu đã bị hủy.', 499));
    if (cancel.aborted) { this.release(); return Promise.reject(cancel.reason); }
    return new Promise<RunningJob>((resolve, reject) => {
      // Settle first so the caller sees its own cancel reason, not a generic one.
      const onCancel = () => { this.settle(); this.release(); reject(cancel.reason); };
      this.pending = { resolve, reject, cancel, onCancel, onWaiting };
      cancel.addEventListener('abort', onCancel, { once: true });
      if (this.state === 'running') this.begin();
      else this.queue.refreshPlaces();
    });
  }

  private begin(): void {
    const pending = this.settle();
    if (!pending) return;
    const controller = new AbortController();
    this.run = controller;
    const timeoutMs = this.queue.options.runTimeoutMs;
    this.runTimer = setTimeout(() => controller.abort(timeoutError(timeoutMs)), timeoutMs);
    pending.resolve({ signal: controller.signal });
  }

  private settle() {
    const pending = this.pending;
    this.pending = undefined;
    pending?.cancel.removeEventListener('abort', pending.onCancel);
    return pending;
  }

  release(): void {
    if (this.state === 'released') return;
    const wasRunning = this.state === 'running';
    this.state = 'released';
    clearTimeout(this.runTimer);
    clearTimeout(this.waitTimer);
    this.runTimer = this.waitTimer = undefined;
    // A job released while still waiting for start() must not hang its caller.
    this.settle()?.reject(new AIError('cancelled', 'Yêu cầu đã bị hủy.', 499));
    this.queue.remove(this, wasRunning);
  }
}

export function timeoutError(ms: number): AIError {
  const text = ms % 60_000 === 0 ? `${ms / 60_000} phút` : `${Math.ceil(ms / 1000)} giây`;
  return new AIError('timeout', `Advanced đã hết thời hạn ${text}.`, 504);
}

/** In-memory FIFO queue. Jobs are lost when the process restarts; clients see the
 * stream end and must retry. Bounded: at most concurrency + maxQueue jobs exist. */
export class JobQueue {
  private readonly running = new Set<Job>();
  private waiting: Job[] = [];
  private closed = false;
  private idle: Array<() => void> = [];

  constructor(readonly options: JobQueueOptions) {
    const bad = (name: string) => { throw new RangeError(`JobQueue: ${name} không hợp lệ.`); };
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) bad('concurrency');
    if (!Number.isInteger(options.maxQueue) || options.maxQueue < 0) bad('maxQueue');
    if (!Number.isFinite(options.runTimeoutMs) || options.runTimeoutMs < 1) bad('runTimeoutMs');
  }

  stats(): JobStats { return { running: this.running.size, waiting: this.waiting.length, closed: this.closed }; }

  /** Takes a slot immediately or a place in line; throws when neither is
   * available. Call before sending response headers so a full queue is a plain
   * HTTP error. */
  admit(owner: string): JobHandle {
    if (this.closed) throw new AIError('shutting_down', 'Máy chủ đang tắt hoặc khởi động lại. Hãy thử lại sau ít phút.', 503, 15);
    const limit = this.options.maxPerOwner;
    if (limit !== undefined && this.countFor(owner) >= limit) {
      throw new AIError('rate_limit', 'Bạn đang có quá nhiều lượt Advanced đang chạy hoặc chờ. Hãy chờ một lượt hoàn tất.', 429, 15);
    }
    const job = new Job(owner, this);
    if (this.running.size < this.options.concurrency && this.waiting.length === 0) {
      this.running.add(job);
      job.grant();
      return job;
    }
    if (this.waiting.length >= this.options.maxQueue) {
      throw new AIError('rate_limit', this.options.maxQueue === 0
        ? 'Advanced đang xử lý một game. Hãy chờ hoàn tất.'
        : `Hàng đợi Advanced đã đầy (${this.waiting.length} đang chờ). Hãy thử lại sau.`, 429, 10);
    }
    this.waiting.push(job);
    job.armWait(this.options.maxWaitMs ?? 60_000);
    return job;
  }

  /** Stop admitting, fail every waiting job, give running jobs `graceMs` to
   * finish, then abort whatever still runs and wait briefly for cleanup. */
  async shutdown(graceMs = 0): Promise<void> {
    this.closed = true;
    const gone = new AIError('shutting_down', 'Máy chủ đang tắt hoặc khởi động lại. Hãy thử lại sau ít phút.', 503, 15);
    for (const job of this.waiting.splice(0)) { job.fail(gone); job.release(); }
    if (graceMs > 0) await this.untilIdle(graceMs);
    for (const job of this.running) job.abortRun(gone);
    await this.untilIdle(2_000);
  }

  private untilIdle(ms: number): Promise<void> {
    if (this.running.size === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); this.idle = this.idle.filter((item) => item !== done); resolve(); };
      const timer = setTimeout(done, ms);
      this.idle.push(done);
    });
  }

  /** @internal Job callbacks. */
  expire(job: Job): void {
    if (job.state !== 'waiting') return;
    job.fail(new AIError('rate_limit', 'Hàng đợi Advanced quá lâu. Hãy thử lại sau.', 429, 30));
    job.release();
  }
  remove(job: Job, wasRunning: boolean): void {
    if (wasRunning) {
      this.running.delete(job);
    } else {
      const index = this.waiting.indexOf(job);
      if (index >= 0) this.waiting.splice(index, 1);
    }
    this.promote();
    if (this.running.size === 0) for (const notify of [...this.idle]) notify();
  }
  refreshPlaces(): void {
    this.waiting.forEach((job, index) => job.place(index + 1));
  }

  private promote(): void {
    while (!this.closed && this.running.size < this.options.concurrency && this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      this.running.add(next);
      next.grant();
    }
    this.refreshPlaces();
  }

  private countFor(owner: string): number {
    let count = 0;
    for (const job of this.running) if (job.owner === owner) count += 1;
    for (const job of this.waiting) if (job.owner === owner) count += 1;
    return count;
  }
}
