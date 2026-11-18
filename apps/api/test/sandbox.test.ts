import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIError } from '../src/providers/errors.js';
import { buildRunArgs, readSandboxConfig, type SandboxConfig } from '../src/sandbox/docker-args.js';
import { DockerGameTester } from '../src/sandbox/docker-game-tester.js';
import { DockerSandbox, type SandboxOutcome, type SandboxRun, type SpawnFn } from '../src/sandbox/docker-sandbox.js';
import { evaluateProbe, type ProbeReport } from '../src/sandbox/probe.js';
import { SANDBOX_MAX_INPUT_BYTES, SandboxInputError, encodeJob, parseJob, parseResult } from '../src/sandbox/protocol.js';
import { shooterPlan } from './agent-fixtures.js';

const config = readSandboxConfig({});
const NAME = 'gc-sbx-123e4567-e89b-12d3-a456-426614174000';
const never = new AbortController().signal;
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('readSandboxConfig', () => {
  it('defaults to one container, 768 MB, 1 CPU: sized for a 2 vCPU / 2 GB host', () => {
    expect(config).toMatchObject({ concurrency: 1, memoryMb: 768, cpus: 1, pids: 256, tmpMb: 64, shmMb: 128, timeoutMs: 45_000, image: 'gamecreator-sandbox:pw1.60.0' });
  });
  it.each([
    ['SANDBOX_IMAGE', 'gamecreator-sandbox:latest'], ['SANDBOX_IMAGE', 'gamecreator-sandbox'.concat(';rm -rf /')], ['SANDBOX_IMAGE', 'UPPER:1'], ['SANDBOX_IMAGE', '-v/:/host'],
    ['SANDBOX_CONCURRENCY', '3'], ['SANDBOX_CONCURRENCY', '0'], ['SANDBOX_MEMORY_MB', '99999'], ['SANDBOX_MEMORY_MB', '10'], ['SANDBOX_CPUS', '16'], ['SANDBOX_CPUS', 'abc'],
    ['SANDBOX_PIDS', '100000'], ['SANDBOX_TIMEOUT_MS', '1'], ['SANDBOX_TIMEOUT_MS', '1.5'], ['SANDBOX_DOCKER_BIN', 'docker\n--privileged'],
  ])('rejects %s=%s instead of falling back', (name, value) => {
    expect(() => readSandboxConfig({ [name]: value })).toThrow();
  });
  it('accepts a digest-pinned image', () => {
    expect(readSandboxConfig({ SANDBOX_IMAGE: `gamecreator-sandbox@sha256:${'a'.repeat(64)}` }).image).toContain('@sha256:');
  });
});

describe('buildRunArgs: the isolation flags', () => {
  const args = buildRunArgs(config, NAME);
  const has = (flag: string) => expect(args).toContain(flag);

  it('contains every hardening flag the requirements list', () => {
    for (const flag of ['--rm', '--init', '--pull=never', '--network=none', '--user=10001:10001', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only',
      '--memory=768m', '--memory-swap=768m', '--cpus=1', '--pids-limit=256', '--log-driver=none', '--interactive']) has(flag);
    expect(args).toContain('--tmpfs'); expect(args).toContain('/tmp:rw,noexec,nosuid,nodev,size=64m');
    expect(args).toContain('--shm-size=128m');
    expect(args.slice(args.indexOf('--ulimit'), args.indexOf('--ulimit') + 2)).toEqual(['--ulimit', 'nofile=1024:1024']);
  });

  it('never grants host access or privilege', () => {
    const text = args.join(' ');
    for (const forbidden of ['--privileged', '--volume', '-v ', '--mount', '--env-file', '--network=host', '--network=bridge', '--pid=host', '--ipc=host', '--uts=host',
      '--cap-add', '--device', 'docker.sock', '--security-opt=seccomp=unconfined', 'apparmor=unconfined', '--userns=host', '--add-host', '--publish', '-p ', '--entrypoint /bin/sh', ':latest']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    expect(args.filter((arg) => arg === '--network=none')).toHaveLength(1);
  });

  it('passes only fixed, non-secret environment values and the image last', () => {
    const env = args.flatMap((arg, i) => arg === '--env' ? [args[i + 1]] : []);
    expect(env).toEqual(['HOME=/tmp', 'NODE_ENV=production', 'GC_CHROMIUM_SANDBOX=0']);
    expect(args.at(-1)).toBe(config.image);
  });

  it('applies configured limits', () => {
    const custom = buildRunArgs({ ...config, memoryMb: 512, cpus: 0.5, pids: 64, tmpMb: 16, shmMb: 32 }, NAME);
    expect(custom).toEqual(expect.arrayContaining(['--memory=512m', '--memory-swap=512m', '--cpus=0.5', '--pids-limit=64', '/tmp:rw,noexec,nosuid,nodev,size=16m', '--shm-size=32m']));
  });

  it('labels containers for cleanup and keeps the command after the image', () => {
    expect(args).toEqual(expect.arrayContaining(['--label', 'gamecreator.sandbox=1']));
    const withCommand = buildRunArgs(config, NAME, { entrypoint: 'node', command: ['-e', '1'] });
    expect(withCommand.slice(-3)).toEqual([config.image, '-e', '1']);
    expect(withCommand).toEqual(expect.arrayContaining(['--entrypoint', 'node']));
  });

  it.each(['../../etc', 'gc-sbx-x', '--privileged', 'gc-sbx-123e4567-e89b-12d3-a456-426614174000; rm', ''])('rejects the container name %j (no path or flag injection)', (name) => {
    expect(() => buildRunArgs(config, name)).toThrow();
  });

  it('contains nothing derived from a job: its size does not depend on game code', () => {
    expect(buildRunArgs(config, NAME)).toEqual(args);
  });
});

describe('sandbox protocol', () => {
  it('round-trips a job and rejects anything unexpected inside the container', () => {
    const text = encodeJob('function create(){}', shooterPlan, 'req');
    expect(parseJob(text)).toMatchObject({ javascript: 'function create(){}', request: 'req' });
    const record = JSON.parse(text) as Record<string, unknown>;
    for (const bad of [{ ...record, extra: 1 }, { ...record, version: 2 }, { ...record, javascript: '' }, { ...record, javascript: 5 }, { ...record, plan: { title: 1 } }, { ...record, request: 'x'.repeat(2001) }, [], null]) {
      expect(() => parseJob(JSON.stringify(bad))).toThrow();
    }
    expect(() => parseJob('{not json')).toThrow();
  });

  it('refuses oversized jobs on the host before starting a container', () => {
    expect(() => encodeJob('x'.repeat(65_537), shooterPlan, '')).toThrow(SandboxInputError);
    expect(() => encodeJob('', shooterPlan, '')).toThrow(SandboxInputError);
    expect(() => encodeJob('ok', shooterPlan, 'x'.repeat(2_001))).toThrow(SandboxInputError);
    expect(SANDBOX_MAX_INPUT_BYTES).toBeGreaterThan(65_536 * 4);
  });

  it('carries shell metacharacters as data', () => {
    const source = 'function create(){} // "; rm -rf / #\n$(id) `id` ../../etc/passwd \u0000';
    expect(parseJob(encodeJob(source, shooterPlan, '$(whoami)')).javascript).toBe(source);
  });

  it('treats the container as untrusted: only the exact result shapes are accepted', () => {
    const ok = JSON.stringify({ version: 1, ok: true, errors: ['a'] });
    expect(parseResult(`${ok}\n`)).toEqual({ version: 1, ok: true, errors: ['a'] });
    expect(parseResult(JSON.stringify({ version: 1, ok: false, code: 'internal', message: 'x'.repeat(900) }))).toMatchObject({ ok: false, code: 'internal' });
    for (const bad of [
      { version: 1, ok: true, errors: ['a'], extra: 'x' }, { version: 2, ok: true, errors: [] }, { version: 1, ok: true, errors: 'a' },
      { version: 1, ok: true, errors: [1] }, { version: 1, ok: true, errors: Array(11).fill('a') }, { version: 1, ok: true, errors: ['x'.repeat(501)] },
      { version: 1, ok: false, code: 'rm -rf', message: 'x' }, { version: 1, ok: false, code: 'internal' }, { version: 1 }, 'text', [], null,
    ]) expect(parseResult(JSON.stringify(bad)), JSON.stringify(bad).slice(0, 60)).toBeUndefined();
    expect(parseResult('not json')).toBeUndefined();
    expect(parseResult('')).toBeUndefined();
    expect((parseResult(JSON.stringify({ version: 1, ok: false, code: 'internal', message: 'x'.repeat(900) })) as { message: string }).message).toHaveLength(300);
  });
});

describe('evaluateProbe', () => {
  const good: ProbeReport = {
    platform: 'linux', uid: 10001, gid: 10001, capEff: '0000000000000000', capBnd: '0000000000000000', noNewPrivs: 1, seccomp: 2, rootWritable: false, tmpWritable: true,
    tmpBytes: 64 * 1024 * 1024, externalAddresses: [], networkReachable: false, dnsResolves: false, dockerSocketPresent: false, hostPathsReadable: [], secretEnvNames: [],
    memoryMaxBytes: 768 * 1024 * 1024, pidsMax: 256, cpuQuota: { quota: 100_000, period: 100_000 }, unexpectedMounts: [],
  };
  it('accepts a report that matches the configuration', () => { expect(evaluateProbe(good, config)).toEqual([]); });
  it.each<[string, Partial<ProbeReport>, RegExp]>([
    ['not linux', { platform: 'win32' }, /Linux/], ['root', { uid: 0 }, /root/], ['root group', { gid: 0 }, /root/],
    ['effective capabilities', { capEff: '00000000a80425fb' }, /CapEff/], ['bounding capabilities', { capBnd: '00000000a80425fb' }, /CapBnd/],
    ['new privileges allowed', { noNewPrivs: 0 }, /no-new-privileges/], ['no seccomp', { seccomp: 0 }, /seccomp/], ['writable root', { rootWritable: true }, /Root filesystem/],
    ['no /tmp', { tmpWritable: false }, /\/tmp/], ['unbounded /tmp', { tmpBytes: 10 * 1024 ** 3 }, /\/tmp/], ['external interface', { externalAddresses: ['172.17.0.2'] }, /giao diện mạng/],
    ['internet', { networkReachable: true }, /Internet/], ['dns', { dnsResolves: true }, /DNS/], ['docker socket', { dockerSocketPresent: true }, /Docker socket/],
    ['host path', { hostPathsReadable: ['/host'] }, /Host/], ['secret env name', { secretEnvNames: ['GROQ_API_KEY'] }, /nhạy cảm/], ['no memory limit', { memoryMaxBytes: null }, /RAM/],
    ['bigger memory limit', { memoryMaxBytes: 4 * 1024 ** 3 }, /RAM/], ['no pids limit', { pidsMax: null }, /process/], ['bigger pids limit', { pidsMax: 100_000 }, /process/],
    ['no cpu limit', { cpuQuota: null }, /CPU/], ['wrong cpu limit', { cpuQuota: { quota: 400_000, period: 100_000 } }, /CPU/], ['extra mount', { unexpectedMounts: ['ext4:/data'] }, /mount/],
  ])('fails when the container has %s', (_name, change, message) => {
    const failures = evaluateProbe({ ...good, ...change }, config);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join(' | ')).toMatch(message);
  });
  it('compares against the configured limits, not constants', () => {
    expect(evaluateProbe(good, { ...config, memoryMb: 256 }).join()).toMatch(/RAM/);
    expect(evaluateProbe({ ...good, memoryMaxBytes: 256 * 1024 * 1024 }, { ...config, memoryMb: 256 })).toEqual([]);
  });
});

// --- host side process handling, with a fake docker CLI -----------------------------------------

interface Call { command: string; args: readonly string[]; options: Record<string, unknown> }
class FakeChild extends EventEmitter {
  stdout = new PassThrough(); stderr = new PassThrough(); stdin = new PassThrough();
  written = ''; killed: string[] = [];
  constructor() { super(); this.stdin.on('data', (chunk: Buffer) => { this.written += chunk.toString(); }); }
  kill(signal?: string) { this.killed.push(signal ?? 'SIGTERM'); return true; }
  exit(code: number | null) { this.stdout.end(); this.stderr.end(); this.emit('close', code); }
}
function harness(onRun: (child: FakeChild, calls: Call[], runArgs: readonly string[]) => void = () => {}, sandboxConfig: SandboxConfig = config) {
  const calls: Call[] = []; const children: FakeChild[] = [];
  const spawnFn: SpawnFn = (command, args, options) => {
    const child = new FakeChild();
    calls.push({ command, args, options: options as Record<string, unknown> });
    if (args[0] === 'run') { children.push(child); queueMicrotask(() => onRun(child, calls, args)); }
    else if (args[0] === 'ps') { queueMicrotask(() => { child.stdout.write(`${psOutput}\n`); child.exit(0); }); }
    else queueMicrotask(() => {
      // `docker kill <name>` ends the container, so the attached `docker run` CLI exits with 137.
      if (args[0] === 'kill') children.find((c) => !c.killed.length)?.exit(137);
      child.exit(0);
    });
    return child as unknown as ChildProcess;
  };
  return { sandbox: new DockerSandbox(sandboxConfig, spawnFn), calls, children };
}
let psOutput = '';
const request = (overrides: Partial<SandboxRun> = {}): SandboxRun => ({ signal: never, timeoutMs: 10_000, maxOutputBytes: 1_000, ...overrides });
const exited = (outcome: SandboxOutcome) => { if (outcome.kind !== 'exited') throw new Error(outcome.detail); return outcome; };

describe('DockerSandbox.run', () => {
  it('spawns the docker CLI without a shell, with an argument array and no backend secrets in its environment', async () => {
    vi.stubEnv('GROQ_API_KEY', 'super-secret'); vi.stubEnv('GEMINI_API_KEY', 'super-secret'); vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'super-secret');
    const h = harness((child) => child.exit(0));
    await h.sandbox.run(request({ stdin: '{"x":1}' }));
    const run = h.calls.find((call) => call.args[0] === 'run')!;
    expect(run.command).toBe('docker');
    expect(run.options.shell).toBe(false);
    expect(Array.isArray(run.args)).toBe(true);
    expect(JSON.stringify(run.options.env)).not.toContain('super-secret');
    expect(Object.keys(run.options.env as object).filter((name) => /key|secret|token/i.test(name))).toEqual([]);
  });

  it('sends the job on stdin, never in the arguments, and returns stdout and the exit code', async () => {
    const h = harness((child) => { child.stdout.write('{"ok":true}'); child.exit(0); });
    const outcome = exited(await h.sandbox.run(request({ stdin: 'GAME-SOURCE-"; rm -rf /' })));
    expect(outcome).toMatchObject({ exitCode: 0, stdout: '{"ok":true}', timedOut: false, aborted: false, truncated: false });
    expect(h.children[0]!.written).toBe('GAME-SOURCE-"; rm -rf /');
    expect(JSON.stringify(h.calls.map((call) => call.args))).not.toContain('GAME-SOURCE');
  });

  it('kills the container (not just the CLI) on timeout, removes it, and leaves no timers', async () => {
    vi.useFakeTimers();
    const h = harness();
    const pending = h.sandbox.run(request({ timeoutMs: 5_000 }));
    await vi.advanceTimersByTimeAsync(5_000);
    const outcome = exited(await pending);
    expect(outcome).toMatchObject({ timedOut: true, aborted: false, exitCode: 137 });
    const name = h.calls.find((call) => call.args[0] === 'run')!.args[h.calls.find((call) => call.args[0] === 'run')!.args.indexOf('--name') + 1];
    expect(h.calls.map((call) => call.args.slice(0, 2).join(' '))).toEqual(expect.arrayContaining([`kill ${name}`, `rm -f`]));
    expect(h.sandbox.activeContainers).toBe(0);
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops the container when the caller aborts, and does not start one if already aborted', async () => {
    const controller = new AbortController();
    const h = harness();
    const pending = h.sandbox.run(request({ signal: controller.signal }));
    await Promise.resolve();
    controller.abort();
    expect(exited(await pending)).toMatchObject({ aborted: true });
    expect(h.calls.some((call) => call.args[0] === 'kill')).toBe(true);

    const already = new AbortController(); already.abort();
    const second = harness();
    expect(exited(await second.sandbox.run(request({ signal: already.signal }))).aborted).toBe(true);
  });

  it('caps output: truncates, kills the container and reports it', async () => {
    const h = harness((child) => { child.stdout.write('A'.repeat(600)); child.stdout.write('B'.repeat(600)); child.stdout.write('C'.repeat(600)); });
    const outcome = exited(await h.sandbox.run(request({ maxOutputBytes: 1_000 })));
    expect(outcome.truncated).toBe(true);
    expect(outcome.stdout.length).toBe(1_000);
    expect(outcome.stdout).not.toContain('C');
    expect(h.calls.some((call) => call.args[0] === 'kill')).toBe(true);
  });

  it('keeps stderr small', async () => {
    const h = harness((child) => { child.stderr.write('E'.repeat(50_000)); child.exit(1); });
    expect(exited(await h.sandbox.run(request())).stderr.length).toBeLessThanOrEqual(2_048);
  });

  it.each([[125, /125/], [126, /126/], [127, /127/]])('treats docker exit %i as "sandbox unavailable", not a game failure', async (code) => {
    const h = harness((child) => { child.stderr.write('Cannot connect to the Docker daemon'); child.exit(code); });
    const outcome = await h.sandbox.run(request());
    expect(outcome.kind).toBe('unavailable');
    expect(outcome.kind === 'unavailable' && outcome.detail).toContain(String(code));
  });

  it('treats a missing docker binary as unavailable', async () => {
    const spawnFn: SpawnFn = () => { const child = new FakeChild(); queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }))); return child as unknown as ChildProcess; };
    expect((await new DockerSandbox(config, spawnFn).run(request())).kind).toBe('unavailable');
    const throwing: SpawnFn = () => { throw new Error('boom'); };
    expect((await new DockerSandbox(config, throwing).run(request())).kind).toBe('unavailable');
  });

  it('gives up on a docker CLI that never exits after the kill and force-ends it', async () => {
    vi.useFakeTimers();
    const calls: Call[] = []; const children: FakeChild[] = [];
    const spawnFn: SpawnFn = (command, args, options) => { const child = new FakeChild(); calls.push({ command, args, options: options as Record<string, unknown> }); if (args[0] === 'run') children.push(child); else queueMicrotask(() => child.exit(0)); return child as unknown as ChildProcess; };
    const pending = new DockerSandbox(config, spawnFn).run(request({ timeoutMs: 1_000 }));
    await vi.advanceTimersByTimeAsync(1_000 + 3_000);
    const outcome = exited(await pending);
    expect(outcome.timedOut).toBe(true);
    expect(children[0]!.killed).toContain('SIGKILL');
    expect(calls.some((call) => call.args[0] === 'rm' && call.args[1] === '-f')).toBe(true);
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('tracks live containers and stopAll() kills each of them', async () => {
    const h = harness();
    const first = h.sandbox.run(request()); const second = h.sandbox.run(request());
    await Promise.resolve(); await Promise.resolve();
    expect(h.sandbox.activeContainers).toBe(2);
    await h.sandbox.stopAll();
    expect(h.calls.filter((call) => call.args[0] === 'kill')).toHaveLength(2);
    h.children.forEach((child) => child.exit(137));
    await Promise.all([first, second]);
    expect(h.sandbox.activeContainers).toBe(0);
  });
});

describe('DockerSandbox.removeStale and verify', () => {
  it('only passes well-formed container ids to docker rm', async () => {
    psOutput = 'abcdef123456 0123456789ab; rm -rf / --privileged ../../x ABCDEF123456 deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const h = harness();
    // Only two of the tokens are lowercase hex ids of 12-64 characters.
    expect(await h.sandbox.removeStale()).toBe(2);
    const rm = h.calls.find((call) => call.args[0] === 'rm')!;
    expect(rm.args.slice(0, 2)).toEqual(['rm', '-f']);
    expect(rm.args).toHaveLength(4);
    for (const id of rm.args.slice(2)) expect(id).toMatch(/^[a-f0-9]{12,64}$/);
    expect(rm.args).not.toContain('--privileged');
    expect(h.calls.find((call) => call.args[0] === 'ps')!.args).toEqual(expect.arrayContaining(['--filter', 'label=gamecreator.sandbox=1']));
  });

  it('does nothing when there are no leftovers', async () => {
    psOutput = '';
    const h = harness();
    expect(await h.sandbox.removeStale()).toBe(0);
    expect(h.calls.some((call) => call.args[0] === 'rm')).toBe(false);
  });

  const report = (extra: Partial<ProbeReport> = {}): string => JSON.stringify({
    platform: 'linux', uid: 10001, gid: 10001, capEff: '0', capBnd: '0', noNewPrivs: 1, seccomp: 2, rootWritable: false, tmpWritable: true, tmpBytes: 64 * 1024 * 1024,
    externalAddresses: [], networkReachable: false, dnsResolves: false, dockerSocketPresent: false, hostPathsReadable: [], secretEnvNames: [], memoryMaxBytes: 768 * 1024 * 1024,
    pidsMax: 256, cpuQuota: { quota: 100_000, period: 100_000 }, unexpectedMounts: [], ...extra,
  });
  it('verifies by running the probe as the entrypoint override and judging its report', async () => {
    const good = harness((child) => { child.stdout.write(report()); child.exit(0); });
    expect((await good.sandbox.verify(never)).ok).toBe(true);
    const args = good.calls.find((call) => call.args[0] === 'run')!.args;
    expect(args).toEqual(expect.arrayContaining(['--entrypoint', 'node', '--network=none']));
    expect(args.at(-1)).toBe('/opt/gc/apps/api/dist/sandbox/probe-main.js');

    const weak = harness((child) => { child.stdout.write(report({ networkReachable: true })); child.exit(0); });
    const result = await weak.sandbox.verify(never);
    expect(result.ok).toBe(false);
    expect(result.failures.join()).toMatch(/Internet/);
  });

  it.each([['garbage', 'not json', 0], ['non-zero exit', '{}', 1]])('fails verification on %s', async (_name, stdout, code) => {
    const h = harness((child) => { child.stdout.write(stdout); child.exit(code); });
    expect((await h.sandbox.verify(never)).ok).toBe(false);
  });

  it('fails verification when docker is unavailable', async () => {
    const h = harness((child) => child.exit(125));
    const result = await h.sandbox.verify(never);
    expect(result.ok).toBe(false);
  });
});

// --- DockerGameTester with a scripted sandbox --------------------------------------------------

function scripted(handler: (request: SandboxRun) => Promise<SandboxOutcome> | SandboxOutcome, verify: () => Promise<{ ok: boolean; failures: string[] }> = async () => ({ ok: true, failures: [] }), sandboxConfig = config) {
  const run = vi.fn(async (req: SandboxRun) => handler(req));
  const fake = { config: sandboxConfig, run, verify: vi.fn(verify), removeStale: vi.fn(async () => 0), stopAll: vi.fn(async () => {}), activeContainers: 0 };
  return { fake, run, tester: new DockerGameTester(fake as unknown as DockerSandbox) };
}
const done = (stdout: string, extra: Partial<Extract<SandboxOutcome, { kind: 'exited' }>> = {}): SandboxOutcome =>
  ({ kind: 'exited', exitCode: 0, stdout, stderr: '', timedOut: false, aborted: false, truncated: false, ...extra });
const okResult = (errors: string[] = []) => JSON.stringify({ version: 1, ok: true, errors });

describe('DockerGameTester', () => {
  it('is not ready until the isolation self-check passed, and then runs nothing on the host', async () => {
    const { tester, run } = scripted(() => done(okResult()));
    expect(tester.readiness().ready).toBe(false);
    await expect(tester.test('x', shooterPlan, never)).rejects.toMatchObject({ code: 'tester_unavailable', status: 503 });
    expect(run).not.toHaveBeenCalled();
    await tester.startup();
    expect(tester.readiness().ready).toBe(true);
    await expect(tester.test('function create(){}', shooterPlan, never, 'prompt')).resolves.toEqual({ errors: [] });
    const sent = run.mock.calls[0]![0];
    expect(parseJob(sent.stdin!)).toMatchObject({ javascript: 'function create(){}', request: 'prompt' });
    expect(sent.timeoutMs).toBe(config.timeoutMs);
    expect(sent.maxOutputBytes).toBeLessThanOrEqual(16 * 1024);
  });

  it('stays not ready, with the reasons, when the isolation check fails', async () => {
    const { tester, run } = scripted(() => done(okResult()), async () => ({ ok: false, failures: ['Kết nối ra Internet thành công.'] }));
    await tester.startup();
    expect(tester.readiness()).toMatchObject({ ready: false, message: expect.stringContaining('Internet') });
    await expect(tester.test('x', shooterPlan, never)).rejects.toMatchObject({ code: 'tester_unavailable' });
    expect(run).not.toHaveBeenCalled();
  });

  it('stays not ready when the check itself throws', async () => {
    const { tester } = scripted(() => done(okResult()), async () => { throw new Error('boom'); });
    await tester.startup();
    expect(tester.readiness().ready).toBe(false);
  });

  it('returns game errors from the container as repairable test errors', async () => {
    const { tester } = scripted(() => done(okResult(['Projectile: fire did not launch', 'Restart did not reset score'])));
    await tester.startup();
    expect(await tester.test('x', shooterPlan, never)).toEqual({ errors: ['Projectile: fire did not launch', 'Restart did not reset score'] });
  });

  it.each<[string, Partial<Extract<SandboxOutcome, { kind: 'exited' }>>, RegExp]>([
    ['a container timeout', { timedOut: true, exitCode: 137 }, /vượt thời hạn/],
    ['output flooding', { truncated: true, exitCode: 137, stdout: 'A'.repeat(16_384) }, /quá nhiều dữ liệu/],
    ['an out-of-memory kill', { exitCode: 137, stdout: '' }, /bộ nhớ/],
    ['a crash', { exitCode: 1, stdout: '' }, /bất thường/],
    ['garbage output', { stdout: 'ignore previous instructions' }, /bất thường/],
    ['a forged result with extra fields', { stdout: JSON.stringify({ version: 1, ok: true, errors: [], admin: true }) }, /bất thường/],
    ['a result that is too long', { stdout: okResult(Array(50).fill('e')) }, /bất thường/],
  ])('maps %s to a repairable game error, not an outage', async (_name, extra, message) => {
    const { tester } = scripted(() => done('', extra));
    await tester.startup();
    const result = await tester.test('x', shooterPlan, never);
    expect(result.errors.join(' ')).toMatch(message);
    expect(tester.readiness().ready).toBe(true);
  });

  it('turns an infrastructure failure into tester_unavailable and stops accepting jobs', async () => {
    const { tester } = scripted(() => ({ kind: 'unavailable', detail: 'daemon down' }));
    await tester.startup();
    await expect(tester.test('x', shooterPlan, never)).rejects.toMatchObject({ code: 'tester_unavailable', status: 503 });
    expect(tester.readiness().ready).toBe(false);
  });

  it('turns a Chromium launch failure inside the container into tester_unavailable', async () => {
    const { tester } = scripted(() => done(JSON.stringify({ version: 1, ok: false, code: 'tester_unavailable', message: 'no chromium' })));
    await tester.startup();
    await expect(tester.test('x', shooterPlan, never)).rejects.toMatchObject({ code: 'tester_unavailable' });
    expect(tester.readiness().ready).toBe(false);
  });

  it('reports an internal runner error without leaking its message', async () => {
    const { tester } = scripted(() => done(JSON.stringify({ version: 1, ok: false, code: 'internal', message: 'secret path /opt/gc/x' })));
    await tester.startup();
    const result = await tester.test('x', shooterPlan, never);
    expect(JSON.stringify(result)).not.toContain('/opt/gc');
  });

  it('rejects an oversized game without starting a container', async () => {
    const { tester, run } = scripted(() => done(okResult()));
    await tester.startup();
    expect((await tester.test('x'.repeat(70_000), shooterPlan, never)).errors[0]).toMatch(/giới hạn/);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs at most config.concurrency containers at once and keeps the others waiting', async () => {
    let live = 0; let peak = 0; const releases: Array<() => void> = [];
    const { tester } = scripted(() => new Promise<SandboxOutcome>((resolve) => { live += 1; peak = Math.max(peak, live); releases.push(() => { live -= 1; resolve(done(okResult())); }); }));
    await tester.startup();
    const results = [1, 2, 3].map((n) => tester.test(`game ${n}`, shooterPlan, never));
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    expect(peak).toBe(1);
    while (releases.length) { releases.shift()!(); await new Promise((r) => setTimeout(r, 5)); }
    await vi.waitFor(() => expect(live).toBe(0));
    await Promise.all(results);
    expect(peak).toBe(1);
  });

  it('propagates caller cancellation and frees its slot', async () => {
    const controller = new AbortController();
    const { tester, run } = scripted((req) => new Promise<SandboxOutcome>((resolve) => req.signal.addEventListener('abort', () => resolve(done('', { aborted: true, exitCode: 137 })), { once: true })));
    await tester.startup();
    const pending = tester.test('x', shooterPlan, controller.signal);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    const reason = new AIError('cancelled', 'client gone', 499);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    // The slot is free again: the next job runs.
    run.mockImplementation(async () => done(okResult()));
    await expect(tester.test('y', shooterPlan, never)).resolves.toEqual({ errors: [] });
  });

  it('does not start work for an already cancelled request', async () => {
    const { tester, run } = scripted(() => done(okResult()));
    await tester.startup();
    const controller = new AbortController(); controller.abort(new AIError('cancelled', 'x', 499));
    await expect(tester.test('x', shooterPlan, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(run).not.toHaveBeenCalled();
  });

  it('repeats the isolation self-check on a schedule, and stops trusting the sandbox if it starts failing', async () => {
    let clock = 0; let healthy = true;
    const { fake } = scripted(() => done(okResult()), async () => (healthy ? { ok: true, failures: [] } : { ok: false, failures: ['changed'] }));
    const tester = new DockerGameTester(fake as unknown as DockerSandbox, () => clock);
    await tester.startup();
    expect(tester.readiness().ready).toBe(true);
    healthy = false; clock += config.recheckMs + 1;
    tester.readiness(); // triggers the background re-check
    await vi.waitFor(() => expect(fake.verify).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(tester.readiness().ready).toBe(false));
  });

  it('shares one self-check between concurrent callers', async () => {
    const { tester, fake } = scripted(() => done(okResult()));
    await Promise.all([tester.verify(), tester.verify(), tester.verify()]);
    expect(fake.verify).toHaveBeenCalledTimes(1);
  });

  it('dispose() stops containers, cancels running jobs and refuses new ones', async () => {
    const { tester, fake } = scripted((req) => new Promise<SandboxOutcome>((resolve) => req.signal.addEventListener('abort', () => resolve(done('', { aborted: true, exitCode: 137 })), { once: true })));
    await tester.startup();
    const pending = tester.test('x', shooterPlan, never).catch((error: unknown) => error);
    await vi.waitFor(() => expect(fake.run).toHaveBeenCalledOnce());
    await tester.dispose();
    expect(await pending).toMatchObject({ code: 'shutting_down' });
    expect(fake.stopAll).toHaveBeenCalled();
    expect(tester.readiness().ready).toBe(false);
    await expect(tester.test('y', shooterPlan, never)).rejects.toMatchObject({ code: 'tester_unavailable' });
  });
});
