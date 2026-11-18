// `npm run sandbox:verify -w @game-creator/api`: run on the machine that will host
// the backend. Starts the real container and checks its isolation against the
// configured limits. Exit 0 only if every check passes.
import { readSandboxConfig } from './docker-args.js';
import { DockerSandbox } from './docker-sandbox.js';

const config = readSandboxConfig(process.env);
console.log(`[sandbox] image=${config.image} memory=${config.memoryMb}m cpus=${config.cpus} pids=${config.pids}`);
const sandbox = new DockerSandbox(config);
await sandbox.removeStale();
const result = await sandbox.verify(AbortSignal.timeout(60_000));
if (result.report) console.log(JSON.stringify(result.report, null, 2));
if (result.ok) {
  console.log('[sandbox] OK: container isolation matches the configuration.');
} else {
  console.error('[sandbox] FAILED:');
  for (const failure of result.failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
}
