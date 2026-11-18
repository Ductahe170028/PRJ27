// Container entrypoint. The image runs this as a non-root user with no
// capabilities, no network and a read-only root filesystem. It reads one job
// from stdin, runs the same Playwright checks as the host tester, and prints
// exactly one JSON line. It never prints job content or error internals.
import { AIError } from '../providers/errors.js';
import { PlaywrightGameTester } from '../agent/game-tester.js';
import { SANDBOX_MAX_INPUT_BYTES, SANDBOX_PROTOCOL_VERSION, parseJob, type SandboxResult } from './protocol.js';

async function readStdin(limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new RangeError('stdin vượt giới hạn');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<SandboxResult> {
  try {
    const job = parseJob(await readStdin(SANDBOX_MAX_INPUT_BYTES));
    // The container is the isolation boundary here; Chromium's own sandbox needs
    // user namespaces, which a dropped-capability container does not have.
    const tester = new PlaywrightGameTester({ chromiumSandbox: process.env.GC_CHROMIUM_SANDBOX !== '0' });
    const result = await tester.test(job.javascript, job.plan, new AbortController().signal, job.request);
    return { version: SANDBOX_PROTOCOL_VERSION, ok: true, errors: result.errors };
  } catch (error) {
    if (error instanceof AIError && error.code === 'tester_unavailable') {
      return { version: SANDBOX_PROTOCOL_VERSION, ok: false, code: 'tester_unavailable', message: error.message };
    }
    return { version: SANDBOX_PROTOCOL_VERSION, ok: false, code: 'internal', message: 'Sandbox runner gặp lỗi nội bộ.' };
  }
}

const result = await main();
process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(0));
