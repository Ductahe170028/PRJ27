import type { Worker } from 'node:worker_threads';
import type { GameSpec } from '@game-creator/contracts';
import { AIError } from '../providers/errors.js';
import { runInWorker } from './worker-run.js';

/** Hard limit for one repair, worker start included. */
export const REPAIR_TIMEOUT_MS = 5_000;
export const REPAIR_TIMEOUT_MESSAGE = 'Không xác nhận được màn chơi trong giới hạn thời gian kiểm tra; game chưa được tạo.';

export interface RepairOptions {
  timeoutMs?: number;
  /** Test seam: observe the worker to check it is always terminated. */
  onWorker?: (worker: Worker) => void;
}

export type RepairRunner = (spec: GameSpec, signal: AbortSignal, options?: RepairOptions) => Promise<GameSpec>;

/** Runs repairGamePlacement in a worker thread (see runInWorker): one worker per
 * request, a hard timeout, terminated on every outcome. */
export const repairInWorker: RepairRunner = (spec, signal, options = {}) => runInWorker<GameSpec>(
  new URL('./repair-worker.mjs', import.meta.url), spec, signal, {
    timeoutMs: options.timeoutMs ?? REPAIR_TIMEOUT_MS,
    onTimeout: () => new AIError('invalid_game_spec', REPAIR_TIMEOUT_MESSAGE, 422, undefined, ['repair']),
    pick: (reply) => reply.game as GameSpec,
    label: 'Repair',
    ...(options.onWorker ? { onWorker: options.onWorker } : {}),
  },
);
