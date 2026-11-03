// Trusted worker bootstrap. Source from AI is DATA passed to the TS compiler;
// it is never imported, evaluated or executed by this Node worker.
import { parentPort, workerData } from 'node:worker_threads';
import { existsSync } from 'node:fs';
const development = new URL('./code-validator.ts', import.meta.url);
const module = existsSync(development)
  ? await (await import('tsx/esm/api')).tsImport(development.href, import.meta.url)
  : await import('./code-validator.js');
parentPort.postMessage(new module.CodeValidator().validate(workerData));
