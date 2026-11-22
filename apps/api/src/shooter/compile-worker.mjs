// Trusted worker bootstrap for compile + bot gate. The job is DATA (an already
// validated brief and a seed); nothing from it is imported or evaluated. Errors
// are serialized field by field: structured clone of an Error drops the AIError
// code, status, issues and details.
import { parentPort, workerData } from 'node:worker_threads';
import { existsSync } from 'node:fs';
const development = new URL('./compile-job.ts', import.meta.url);
const module = existsSync(development)
  ? await (await import('tsx/esm/api')).tsImport(development.href, import.meta.url)
  : await import('./compile-job.js');
try {
  parentPort.postMessage({ ok: true, compiled: module.compileAndGate(workerData) });
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
