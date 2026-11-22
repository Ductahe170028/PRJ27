import { Worker } from 'node:worker_threads';
import { AIError, type AIErrorCode, type SpecIssue } from '../providers/errors.js';

export type WorkerReply =
  | { ok: true; [field: string]: unknown }
  | { ok: false; error: { kind: 'ai'; code: AIErrorCode; message: string; status: number; retryAfterSeconds?: number; issues?: string[]; details?: SpecIssue[] } }
  | { ok: false; error: { kind: 'internal'; message: string } };

export interface WorkerRunOptions<T> {
  timeoutMs: number;
  /** The error to reject with when the time is up. */
  onTimeout: () => Error;
  /** Reads the result out of a successful reply. */
  pick: (reply: { ok: true; [field: string]: unknown }) => T;
  /** Names the job in errors that are not AIErrors ("Repair worker failed: …"). */
  label: string;
  /** Test seam: observe the worker to check it is always terminated. */
  onWorker?: (worker: Worker) => void;
}

/** Runs one job in a worker thread so the API event loop keeps serving
 * requests. Same isolation as IsolatedCodeValidator: one worker per request, no
 * pool, no retry, minimal env and resource limits. The worker is terminated on
 * success, error, timeout and abort before the promise settles. The worker file
 * replies with `{ ok: true, … }` or a field-by-field serialized error (structured
 * clone of an Error drops the AIError code, status, issues and details). */
export function runInWorker<T>(url: URL, data: unknown, signal: AbortSignal, options: WorkerRunOptions<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(new AIError('cancelled', 'Yêu cầu đã bị hủy.', 499)); return; }
    const worker = new Worker(url, {
      workerData: data, execArgv: [],
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
    const timer = setTimeout(() => finish(() => reject(options.onTimeout())), options.timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    worker.once('message', (reply: WorkerReply) => finish(() => {
      if (reply.ok) { resolve(options.pick(reply)); return; }
      const { error } = reply;
      if (error.kind === 'ai') reject(new AIError(error.code, error.message, error.status, error.retryAfterSeconds, error.issues, error.details));
      else reject(new Error(`${options.label} worker failed: ${error.message}`));
    }));
    worker.once('error', (error) => finish(() => reject(new Error(`${options.label} worker failed: ${error.message}`))));
    worker.once('exit', () => finish(() => reject(new Error(`${options.label} worker stopped before replying.`))));
  });
}
