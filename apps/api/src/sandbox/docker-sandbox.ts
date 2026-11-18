import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { SANDBOX_ENTRY_DIR, SANDBOX_LABEL, buildRunArgs, type SandboxConfig } from './docker-args.js';
import { evaluateProbe, type ProbeReport } from './probe.js';

export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface SandboxRun {
  stdin?: string;
  entrypoint?: string;
  command?: readonly string[];
  /** Caller cancellation (client disconnect, job timeout, shutdown). */
  signal: AbortSignal;
  timeoutMs: number;
  maxOutputBytes: number;
}

export type SandboxOutcome =
  | { kind: 'unavailable'; detail: string }
  | { kind: 'exited'; exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; aborted: boolean; truncated: boolean };

export interface VerifyResult { ok: boolean; failures: string[]; report?: ProbeReport }

/** Variables the docker CLI itself needs. Backend secrets are not among them, and
 * none of this reaches the container: the CLI only talks to the daemon. */
const CLI_ENV = ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP',
  'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'XDG_RUNTIME_DIR'];
const STDERR_LIMIT = 2_048;
const KILL_GRACE_MS = 3_000;
const HELPER_TIMEOUT_MS = 10_000;

/** Runs a command in a throw-away, locked-down container. Does not decide what
 * to run: callers pass stdin and, for self-checks and tests, a command. */
export class DockerSandbox {
  private readonly active = new Set<string>();

  constructor(readonly config: SandboxConfig, private readonly spawnFn: SpawnFn = spawn) {}

  get activeContainers(): number { return this.active.size; }

  async run(request: SandboxRun): Promise<SandboxOutcome> {
    const name = `gc-sbx-${randomUUID()}`;
    const args = buildRunArgs(this.config, name, {
      ...(request.entrypoint ? { entrypoint: request.entrypoint } : {}),
      ...(request.command ? { command: request.command } : {}),
    });
    return new Promise<SandboxOutcome>((resolve) => {
      let child: ChildProcess;
      try { child = this.spawnFn(this.config.dockerBin, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true, env: this.cliEnv() }); }
      catch { resolve({ kind: 'unavailable', detail: 'Không chạy được Docker CLI.' }); return; }

      this.active.add(name);
      const out: Buffer[] = [];
      let outSize = 0;
      let stderr = '';
      let timedOut = false;
      let aborted = false;
      let truncated = false;
      let killed = false;
      let finished = false;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = (outcome: SandboxOutcome) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer); clearTimeout(forceTimer);
        request.signal.removeEventListener('abort', onAbort);
        this.active.delete(name);
        // --rm normally removes the container. After a kill, make sure.
        if (killed) void this.helper(['rm', '-f', name]);
        resolve(outcome);
      };
      const terminate = () => {
        if (killed) return;
        killed = true;
        // Killing the CLI would leave the container running; kill the container.
        void this.helper(['kill', name]);
        forceTimer = setTimeout(() => {
          child.kill('SIGKILL');
          finish({ kind: 'exited', exitCode: null, stdout: '', stderr: '', timedOut, aborted, truncated });
        }, KILL_GRACE_MS);
      };
      const onAbort = () => { aborted = true; terminate(); };
      const timer = setTimeout(() => { timedOut = true; terminate(); }, request.timeoutMs);
      request.signal.addEventListener('abort', onAbort, { once: true });
      if (request.signal.aborted) onAbort();

      child.stdout?.on('data', (chunk: Buffer) => {
        if (truncated) return;
        if (outSize + chunk.length > request.maxOutputBytes) {
          truncated = true;
          out.push(chunk.subarray(0, Math.max(0, request.maxOutputBytes - outSize)));
          outSize = request.maxOutputBytes;
          terminate();
          return;
        }
        out.push(chunk); outSize += chunk.length;
      });
      child.stderr?.on('data', (chunk: Buffer) => { if (stderr.length < STDERR_LIMIT) stderr += chunk.toString('utf8', 0, STDERR_LIMIT); });
      child.once('error', () => finish({ kind: 'unavailable', detail: 'Không chạy được Docker CLI.' }));
      child.once('close', (code) => {
        const stdout = Buffer.concat(out).toString('utf8');
        // 125 daemon/CLI error, 126/127 the image cannot start its entrypoint.
        if (!killed && (code === 125 || code === 126 || code === 127)) {
          finish({ kind: 'unavailable', detail: `Docker không khởi chạy được sandbox (mã ${code}): ${stderr.trim().slice(0, 200)}` });
          return;
        }
        finish({ kind: 'exited', exitCode: code, stdout, stderr: stderr.slice(0, STDERR_LIMIT), timedOut, aborted, truncated });
      });
      child.stdin?.on('error', () => { /* the container may exit before reading */ });
      child.stdin?.end(request.stdin ?? '');
    });
  }

  /** Runs the in-container probe and compares it with the configured limits. */
  async verify(signal: AbortSignal): Promise<VerifyResult> {
    const outcome = await this.run({
      entrypoint: 'node', command: [`${SANDBOX_ENTRY_DIR}/probe-main.js`],
      signal, timeoutMs: 30_000, maxOutputBytes: 16 * 1024,
    });
    if (outcome.kind === 'unavailable') return { ok: false, failures: [outcome.detail] };
    if (outcome.exitCode !== 0 || outcome.truncated || outcome.timedOut) return { ok: false, failures: ['Probe cách ly không hoàn thành.'] };
    try {
      const report = JSON.parse(outcome.stdout) as ProbeReport;
      const failures = evaluateProbe(report, this.config);
      return { ok: failures.length === 0, failures, report };
    } catch {
      return { ok: false, failures: ['Probe cách ly trả dữ liệu không hợp lệ.'] };
    }
  }

  /** Removes sandbox containers left by a crashed backend. */
  async removeStale(): Promise<number> {
    const listed = await this.capture(['ps', '-aq', '--filter', `label=${SANDBOX_LABEL}`]);
    const ids = listed.split(/\s+/).filter((id) => /^[a-f0-9]{12,64}$/.test(id));
    if (ids.length > 0) await this.helper(['rm', '-f', ...ids]);
    return ids.length;
  }

  /** Kills every container this process started. */
  async stopAll(): Promise<void> {
    await Promise.all([...this.active].map((name) => this.helper(['kill', name])));
  }

  private cliEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const name of CLI_ENV) if (process.env[name] !== undefined) env[name] = process.env[name];
    return env;
  }

  /** Short docker command whose failure is not interesting. */
  private helper(args: readonly string[]): Promise<void> {
    return new Promise((resolve) => {
      try {
        const child = this.spawnFn(this.config.dockerBin, args, { stdio: 'ignore', shell: false, windowsHide: true, env: this.cliEnv() });
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, HELPER_TIMEOUT_MS);
        const done = () => { clearTimeout(timer); resolve(); };
        child.once('error', done); child.once('close', done);
      } catch { resolve(); }
    });
  }

  private capture(args: readonly string[]): Promise<string> {
    return new Promise((resolve) => {
      try {
        const child = this.spawnFn(this.config.dockerBin, args, { stdio: ['ignore', 'pipe', 'ignore'], shell: false, windowsHide: true, env: this.cliEnv() });
        let text = '';
        child.stdout?.on('data', (chunk: Buffer) => { if (text.length < 64 * 1024) text += chunk.toString('utf8'); });
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(''); }, HELPER_TIMEOUT_MS);
        const done = () => { clearTimeout(timer); resolve(text); };
        child.once('error', () => { clearTimeout(timer); resolve(''); }); child.once('close', done);
      } catch { resolve(''); }
    });
  }
}
