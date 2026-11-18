import type { GamePlan } from '@game-creator/contracts';
import type { GameTester, TestResult, TesterReadiness } from '../agent/game-tester.js';
import { AIError } from '../providers/errors.js';
import { JobQueue } from '../services/job-queue.js';
import type { SandboxConfig } from './docker-args.js';
import { DockerSandbox } from './docker-sandbox.js';
import { SANDBOX_MAX_OUTPUT_BYTES, SandboxInputError, encodeJob, parseResult } from './protocol.js';

const UNKNOWN: TesterReadiness = { ready: false, message: 'Đang kiểm tra Docker sandbox. Advanced chưa sẵn sàng.' };

/** Runs the Playwright checks inside Docker. If Docker or the isolation check is
 * unavailable it fails closed: it never starts Chromium on the host and the
 * caller reports Advanced as unavailable. */
export class DockerGameTester implements GameTester {
  private state: TesterReadiness = UNKNOWN;
  private checkedAt: number | undefined;
  private verifying: Promise<void> | undefined;
  private readonly slots: JobQueue;
  private readonly lifetime = new AbortController();

  constructor(private readonly sandbox: DockerSandbox, private readonly now: () => number = Date.now) {
    const config = sandbox.config;
    // Chromium is the scarce resource: no more containers than the host can hold.
    this.slots = new JobQueue({ concurrency: config.concurrency, maxQueue: 8, runTimeoutMs: config.timeoutMs + 15_000, maxWaitMs: 120_000 });
  }

  private get config(): SandboxConfig { return this.sandbox.config; }

  readiness(): TesterReadiness {
    const interval = this.state.ready ? this.config.recheckMs : Math.min(this.config.recheckMs, 60_000);
    if (!this.verifying && this.checkedAt !== undefined && this.now() - this.checkedAt >= interval) void this.verify();
    return this.state;
  }

  async startup(): Promise<void> {
    await this.sandbox.removeStale().catch(() => 0);
    await this.verify();
  }

  /** Re-runs the isolation self-check. Concurrent callers share one run. */
  verify(): Promise<void> {
    this.verifying ??= (async () => {
      try {
        const result = await this.sandbox.verify(this.lifetime.signal);
        this.state = result.ok
          ? { ready: true, message: 'Docker sandbox đã qua kiểm tra cách ly.' }
          : { ready: false, message: `Docker sandbox không đạt kiểm tra cách ly: ${result.failures.slice(0, 3).join(' ')}`.slice(0, 400) };
      } catch {
        this.state = { ready: false, message: 'Không kiểm tra được Docker sandbox.' };
      } finally {
        this.checkedAt = this.now();
        this.verifying = undefined;
      }
    })();
    return this.verifying;
  }

  async dispose(): Promise<void> {
    this.lifetime.abort();
    await this.slots.shutdown(0);
    await this.sandbox.stopAll();
    this.state = { ready: false, message: 'Sandbox đã dừng.' };
  }

  async test(javascript: string, plan: GamePlan, signal: AbortSignal, request = ''): Promise<TestResult> {
    if (signal.aborted) throw signal.reason;
    const ready = this.readiness();
    if (!ready.ready) throw unavailable(ready.message);
    let payload: string;
    try { payload = encodeJob(javascript, plan, request); }
    catch (error) {
      if (error instanceof SandboxInputError) return { errors: [error.message] };
      throw error;
    }

    const slot = this.slots.admit('sandbox');
    try {
      const running = await slot.start(signal);
      const outcome = await this.sandbox.run({
        stdin: payload, signal: AbortSignal.any([signal, running.signal, this.lifetime.signal]),
        timeoutMs: this.config.timeoutMs, maxOutputBytes: SANDBOX_MAX_OUTPUT_BYTES,
      });
      if (signal.aborted) throw signal.reason;
      if (outcome.kind === 'unavailable') {
        this.state = { ready: false, message: 'Docker sandbox không khả dụng.' };
        this.checkedAt = this.now();
        throw unavailable(this.state.message);
      }
      if (outcome.aborted) throw new AIError('shutting_down', 'Sandbox đã dừng.', 503);
      if (outcome.timedOut) return { errors: [`Sandbox dừng game vì vượt thời hạn ${Math.round(this.config.timeoutMs / 1000)} giây.`] };
      if (outcome.truncated) return { errors: ['Sandbox dừng game vì tạo quá nhiều dữ liệu đầu ra.'] };
      // 137 = SIGKILL from the kernel: the memory limit, not an infrastructure fault.
      if (outcome.exitCode === 137) return { errors: ['Sandbox dừng game vì vượt giới hạn bộ nhớ.'] };
      const result = outcome.exitCode === 0 ? parseResult(outcome.stdout) : undefined;
      if (!result) return { errors: [`Sandbox kết thúc bất thường (mã ${outcome.exitCode ?? 'không rõ'}).`] };
      if (!result.ok) {
        if (result.code === 'tester_unavailable') {
          this.state = { ready: false, message: 'Chromium trong sandbox không khởi chạy được.' };
          this.checkedAt = this.now();
          throw unavailable(this.state.message);
        }
        return { errors: ['Sandbox runner gặp lỗi khi kiểm tra game.'] };
      }
      return { errors: result.errors };
    } finally {
      slot.release();
    }
  }
}

function unavailable(message: string): AIError {
  return new AIError('tester_unavailable', `${message} Advanced tạm thời không dùng được; hệ thống không chạy code AI trên máy chủ.`.slice(0, 500), 503);
}
