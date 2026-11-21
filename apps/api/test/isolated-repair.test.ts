import type { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AIError } from '../src/providers/errors.js';
import { GameGenerationService, parseGameSpec, parseGameSpecInput } from '../src/services/game-generation-service.js';
import { REPAIR_TIMEOUT_MESSAGE, repairInWorker } from '../src/services/isolated-repair.js';
import { mockProvider, mockRegistry } from './fixtures.js';
import { fixtureSpec, standardFixture } from './standard-fixtures.js';

const live = ['c36f', 'dca2', '2ef2', 'eb2a', '8db8'];
const signal = () => new AbortController().signal;
// Under the parallel suite a dev (tsx) worker can need more than the 5s
// production limit just to compile and start. Result checks use a wide limit;
// the limit itself is tested below with a tiny one.
const WIDE = 30_000;

/** Records the worker and whether it exited before the promise settled. */
function watch() {
  const seen: { worker?: Worker; exited: boolean } = { exited: false };
  return {
    seen,
    onWorker: (worker: Worker) => { seen.worker = worker; worker.once('exit', () => { seen.exited = true; }); },
  };
}

const errorShape = (error: unknown) => {
  const e = error as AIError;
  return { name: e.constructor.name, code: e.code, status: e.status, message: e.message, issues: e.issues, details: e.details, retryAfterSeconds: e.retryAfterSeconds };
};

describe('repair in a worker thread', () => {
  it.each(live)('%s: same result as the synchronous repair, worker terminated', async (name) => {
    const text = JSON.stringify(fixtureSpec(name));
    const { seen, onWorker } = watch();
    const game = await repairInWorker(parseGameSpecInput(text), signal(), { onWorker, timeoutMs: WIDE });
    expect(game).toEqual(parseGameSpec(text));
    expect(seen.exited).toBe(true);
    expect(seen.worker!.threadId).toBe(-1);
  }, 30_000);

  it('keeps the AIError path, code, status, message and details', async () => {
    const game = fixtureSpec('eb2a');
    game.lose.timeLimitSeconds = 5;
    const text = JSON.stringify(game);
    let syncError: unknown;
    try { parseGameSpec(text); } catch (error) { syncError = error; }
    const { seen, onWorker } = watch();
    const workerError = await repairInWorker(parseGameSpecInput(text), signal(), { onWorker, timeoutMs: WIDE }).catch((error: unknown) => error);
    expect(workerError).toBeInstanceOf(AIError);
    expect(errorShape(workerError)).toEqual(errorShape(syncError));
    expect(errorShape(workerError)).toMatchObject({ code: 'invalid_game_spec', status: 422, issues: ['lose.timeLimitSeconds'] });
    expect(seen.exited).toBe(true);
  }, 30_000);

  it('times out with 422 at path "repair" and terminates the worker', async () => {
    const { seen, onWorker } = watch();
    const error = await repairInWorker(parseGameSpecInput(JSON.stringify(fixtureSpec('dca2'))), signal(), { timeoutMs: 1, onWorker })
      .catch((caught: unknown) => caught);
    expect(errorShape(error)).toMatchObject({ code: 'invalid_game_spec', status: 422, issues: ['repair'], message: REPAIR_TIMEOUT_MESSAGE });
    expect(seen.exited).toBe(true);
  }, 30_000);

  it('a client abort terminates the worker with 499', async () => {
    const controller = new AbortController();
    const { seen, onWorker } = watch();
    const pending = repairInWorker(parseGameSpecInput(JSON.stringify(fixtureSpec('dca2'))), controller.signal, {
      timeoutMs: WIDE, onWorker: (worker) => { onWorker(worker); setTimeout(() => controller.abort(), 20); },
    });
    const error = await pending.catch((caught: unknown) => caught);
    expect(errorShape(error)).toMatchObject({ code: 'cancelled', status: 499 });
    expect(seen.exited).toBe(true);
    // An already aborted request never starts a worker.
    let started = false;
    const early = await repairInWorker(parseGameSpecInput(JSON.stringify(fixtureSpec('8db8'))), controller.signal, { onWorker: () => { started = true; } })
      .catch((caught: unknown) => caught);
    expect(errorShape(early)).toMatchObject({ code: 'cancelled', status: 499 });
    expect(started).toBe(false);
  }, 30_000);

  it('the HTTP response is the same as before for a repair failure and a schema failure', async () => {
    for (const [name, patch] of [
      ['eb2a', (spec: Record<string, unknown>) => { (spec.lose as { timeLimitSeconds: number }).timeLimitSeconds = 5; }],
      ['b769', () => {}],
    ] as const) {
      const spec = standardFixture(name).spec as Record<string, unknown>;
      patch(spec);
      const text = JSON.stringify(spec);
      let expected: AIError | undefined;
      try { parseGameSpec(text); } catch (error) { expected = error as AIError; }
      const provider = mockProvider('groq', async () => text);
      const service = new GameGenerationService(mockRegistry([provider]), undefined, undefined, undefined,
        (spec, abort) => repairInWorker(spec, abort, { timeoutMs: WIDE }));
      const app = createApp({ generationService: service });
      const result = await request(app).post('/api/games/generate').send({ providerId: 'groq', prompt: 'Crystal Mine' }).expect(expected!.status);
      const issues = expected!.details?.length ? expected!.details : expected!.issues;
      expect(result.body).toEqual({ error: { code: expected!.code, message: expected!.message, ...(issues?.length ? { issues } : {}) } });
    }
  }, 30_000);
});
