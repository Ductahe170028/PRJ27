import { Worker } from 'node:worker_threads';
import type { GameSpec } from '@game-creator/contracts';
import { AIError, type AIErrorCode, type SpecIssue } from '../providers/errors.js';

/** Hard limit for one repair, worker start included. */
export const REPAIR_TIMEOUT_MS = 5_000;
export const REPAIR_TIMEOUT_MESSAGE = 'Không xác nhận được màn chơi trong giới hạn thời gian kiểm tra; game chưa được tạo.';

export interface RepairOptions {
  timeoutMs?: number;
  /** Test seam: observe the worker to check it is always terminated. */
  onWorker?: (worker: Worker) => void;
}

export type RepairRunner = (spec: GameSpec, signal: AbortSignal, options?: RepairOptions) => Promise<GameSpec>;

type WorkerReply =
  | { ok: true; game: GameSpec }
  | { ok: false; error: { kind: 'ai'; code: AIErrorCode; message: string; status: number; retryAfterSeconds?: number; issues?: string[]; details?: SpecIssue[] } }
  | { ok: false; error: { kind: 'internal'; message: string } };

/** Runs repairGamePlacement in a worker thread so the API event loop keeps
 * serving requests. Same isolation as IsolatedCodeValidator: one worker per
 * request, no pool, no retry, minimal env and resource limits. The worker is
 * terminated on success, error, timeout and abort before the promise settles. */
export const repairInWorker: RepairRunner = (spec, signal, options = {}) => new Promise<GameSpec>((resolve, reject) => {
  if (signal.aborted) { reject(new AIError('cancelled', 'Yêu cầu đã bị hủy.', 499)); return; }
  const worker = new Worker(new URL('./repair-worker.mjs', import.meta.url), {
    workerData: spec, execArgv: [],
    env: { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', TEMP: process.env.TEMP ?? '' },
    resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
  });
  options.onWorker?.(worker);
  let done = false;
  const finish = (settle: () => void) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    // Settle only after the worker is gone; keep listeners until then.
    void worker.terminate().then(settle, settle).finally(() => worker.removeAllListeners());
  };
  const abort = () => finish(() => reject(new AIError('cancelled', 'Yêu cầu đã bị hủy.', 499)));
  const timer = setTimeout(
    () => finish(() => reject(new AIError('invalid_game_spec', REPAIR_TIMEOUT_MESSAGE, 422, undefined, ['repair']))),
    options.timeoutMs ?? REPAIR_TIMEOUT_MS,
  );
  signal.addEventListener('abort', abort, { once: true });
  worker.once('message', (reply: WorkerReply) => finish(() => {
    if (reply.ok) { resolve(reply.game); return; }
    const { error } = reply;
    if (error.kind === 'ai') reject(new AIError(error.code, error.message, error.status, error.retryAfterSeconds, error.issues, error.details));
    else reject(new Error(`Repair worker failed: ${error.message}`));
  }));
  worker.once('error', (error) => finish(() => reject(new Error(`Repair worker failed: ${error.message}`))));
  worker.once('exit', () => finish(() => reject(new Error('Repair worker stopped before replying.'))));
});
