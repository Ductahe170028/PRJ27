import type { Worker } from 'node:worker_threads';
import { AIError } from '../providers/errors.js';
import { runInWorker } from '../services/worker-run.js';
import type { CompileJob, CompiledShooter } from './compile-job.js';

/** Hard limit for compile + gate together, worker start included. */
export const COMPILE_TIMEOUT_MS = 8_000;
export const COMPILE_TIMEOUT_MESSAGE = 'Dựng màn chơi quá lâu. Hãy đơn giản hóa mô tả.';

export interface CompileRunOptions {
  timeoutMs?: number;
  /** Test seam: observe the worker to check it is always terminated. */
  onWorker?: (worker: Worker) => void;
}

export type CompileRunner = (job: CompileJob, signal: AbortSignal, options?: CompileRunOptions) => Promise<CompiledShooter>;

/** Compile + bot gate in a worker thread, so a long level never blocks the API.
 * One worker per request, a hard timeout, terminated on every outcome. */
export const compileInWorker: CompileRunner = (job, signal, options = {}) => runInWorker<CompiledShooter>(
  new URL('./compile-worker.mjs', import.meta.url), job, signal, {
    timeoutMs: options.timeoutMs ?? COMPILE_TIMEOUT_MS,
    onTimeout: () => new AIError('compile_timeout', COMPILE_TIMEOUT_MESSAGE, 422, undefined, ['compile']),
    pick: (reply) => reply.compiled as CompiledShooter,
    label: 'Compile',
    ...(options.onWorker ? { onWorker: options.onWorker } : {}),
  },
);
