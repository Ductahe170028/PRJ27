// Trusted worker bootstrap for GameSpec placement repair. The GameSpec is DATA
// (already parsed and schema-checked); nothing from it is imported or evaluated.
// Errors are serialized field by field: structured clone of an Error drops the
// AIError code, status, issues and details.
import { parentPort, workerData } from 'node:worker_threads';
import { existsSync } from 'node:fs';
const development = new URL('./repair-game-placement.ts', import.meta.url);
const module = existsSync(development)
  ? await (await import('tsx/esm/api')).tsImport(development.href, import.meta.url)
  : await import('./repair-game-placement.js');
try {
  parentPort.postMessage({ ok: true, game: module.repairGamePlacement(workerData) });
} catch (error) {
  const known = error !== null && typeof error === 'object' && typeof error.code === 'string' && typeof error.status === 'number';
  parentPort.postMessage({
    ok: false,
    error: known
      ? {
        kind: 'ai', code: error.code, message: String(error.message), status: error.status,
        retryAfterSeconds: error.retryAfterSeconds, issues: error.issues, details: error.details,
      }
      : { kind: 'internal', message: error instanceof Error ? error.message : String(error) },
  });
}
