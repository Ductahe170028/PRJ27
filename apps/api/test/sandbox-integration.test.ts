// Real Docker tests. They need a running daemon and the image built by
// `npm run sandbox:build`, so they are opt-in:
//   bash:       SANDBOX_INTEGRATION=1 npm run test:sandbox
//   PowerShell: $env:SANDBOX_INTEGRATION='1'; npm run test:sandbox
// They attack the sandbox from inside (fork bomb, memory, network, host paths ...)
// and Docker Desktop (Windows/macOS) results are NOT proof for Ubuntu: rerun on EC2.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CodeValidator } from '../src/agent/code-validator.js';
import { AIError } from '../src/providers/errors.js';
import { DockerGameTester } from '../src/sandbox/docker-game-tester.js';
import { DockerSandbox, type SandboxOutcome } from '../src/sandbox/docker-sandbox.js';
import { SANDBOX_LABEL, readSandboxConfig, type SandboxConfig } from '../src/sandbox/docker-args.js';
import { evaluateProbe, type ProbeReport } from '../src/sandbox/probe.js';
import { shooterPlan, shooterSource } from './agent-fixtures.js';

const enabled = process.env.SANDBOX_INTEGRATION === '1';
const base = readSandboxConfig({});
const never = new AbortController().signal;
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const leftovers = () => docker('ps', '-aq', '--filter', `label=${SANDBOX_LABEL}`).split(/\s+/).filter(Boolean);

function sandbox(overrides: Partial<SandboxConfig> = {}) { return new DockerSandbox({ ...base, ...overrides }); }
/** Runs a Node script inside the container as the job user. */
function node(script: string, overrides: Partial<SandboxConfig> = {}, extra: { signal?: AbortSignal; timeoutMs?: number; max?: number } = {}) {
  const config = { ...base, ...overrides };
  return new DockerSandbox(config).run({
    entrypoint: 'node', command: ['-e', script], signal: extra.signal ?? never,
    timeoutMs: extra.timeoutMs ?? 20_000, maxOutputBytes: extra.max ?? 16 * 1024,
  });
}
function exited(outcome: SandboxOutcome) {
  if (outcome.kind !== 'exited') throw new Error(`sandbox unavailable: ${outcome.detail}`);
  return outcome;
}
async function expectCleanedUp() {
  for (let i = 0; i < 30; i += 1) { if (leftovers().length === 0) return; await new Promise((r) => setTimeout(r, 300)); }
  expect(leftovers()).toEqual([]);
}
const compile = (source: string) => {
  const result = new CodeValidator().validate(source);
  if (!result.javascript) throw new Error(result.errors.join('\n'));
  return result.javascript;
};

describe.skipIf(!enabled)('Docker sandbox: real isolation', () => {
  const canaryDir = enabled ? mkdtempSync(join(tmpdir(), 'gc-canary-')) : '';
  const canaryFile = join(canaryDir, 'secret.txt');
  beforeAll(() => {
    docker('image', 'inspect', base.image); // fails clearly if `npm run sandbox:build` was not run
    writeFileSync(canaryFile, 'HOST-SECRET-CANARY');
    process.env.GC_CANARY_SECRET = 'HOST-ENV-CANARY';
  });
  afterAll(() => { delete process.env.GC_CANARY_SECRET; if (canaryDir) rmSync(canaryDir, { recursive: true, force: true }); });

  it('passes the in-container self-check against the configured limits', async () => {
    const result = await sandbox().verify(never);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  }, 60_000);

  it('negative control: the self-check detects a container started WITHOUT the hardening flags', () => {
    const json = docker('run', '--rm', '--pull=never', '--user=0', '--entrypoint', 'node', base.image, '/opt/gc/apps/api/dist/sandbox/probe-main.js');
    const failures = evaluateProbe(JSON.parse(json) as ProbeReport, base);
    const text = failures.join(' | ');
    expect(text).toContain('root');
    expect(text).toContain('capability');
    expect(text).toContain('no-new-privileges');
    expect(text).toContain('Internet');
    expect(text).toContain('RAM');
    expect(failures.length).toBeGreaterThanOrEqual(6);
  }, 60_000);

  it('runs unprivileged: not root, no capabilities, no-new-privileges', async () => {
    const out = exited(await node(`
      const s = require('fs').readFileSync('/proc/self/status','utf8');
      const f = (n) => new RegExp('^'+n+':\\\\s*(\\\\S+)','m').exec(s)[1];
      console.log(JSON.stringify({ uid: process.getuid(), cap: f('CapEff'), bnd: f('CapBnd'), nnp: f('NoNewPrivs') }));`));
    expect(JSON.parse(out.stdout)).toEqual({ uid: 10001, cap: '0000000000000000', bnd: '0000000000000000', nnp: '1' });
  }, 60_000);

  it('cannot gain root through setuid or chown', async () => {
    const out = exited(await node(`
      const fs = require('fs'); const r = {};
      try { process.setuid(0); r.setuid = 'ALLOWED'; } catch (e) { r.setuid = e.code; }
      try { fs.chownSync('/tmp', 0, 0); r.chown = 'ALLOWED'; } catch (e) { r.chown = e.code; }
      console.log(JSON.stringify(r));`));
    expect(JSON.parse(out.stdout)).toEqual({ setuid: 'EPERM', chown: 'EPERM' });
  }, 60_000);

  it('has no outbound network: TCP, DNS, HTTP and the cloud metadata address all fail', async () => {
    const out = exited(await node(`
      const net = require('net'); const dns = require('dns/promises');
      const tcp = (h, p) => new Promise((ok) => { const s = net.connect({ host: h, port: p }); s.setTimeout(2000, () => { s.destroy(); ok('timeout'); }); s.on('connect', () => { s.destroy(); ok('CONNECTED'); }); s.on('error', (e) => ok(e.code)); });
      (async () => {
        const r = { cloudflare: await tcp('1.1.1.1', 443), metadata: await tcp('169.254.169.254', 80), gateway: await tcp('172.17.0.1', 80) };
        r.dns = await dns.lookup('example.com').then(() => 'RESOLVED', (e) => e.code);
        r.fetch = await fetch('http://169.254.169.254/latest/meta-data/', { signal: AbortSignal.timeout(3000) }).then(() => 'FETCHED', () => 'failed');
        r.interfaces = Object.keys(require('os').networkInterfaces());
        console.log(JSON.stringify(r));
      })();`));
    const result = JSON.parse(out.stdout) as Record<string, unknown>;
    expect(JSON.stringify(result)).not.toMatch(/CONNECTED|RESOLVED|FETCHED/);
    expect(result.interfaces).toEqual(['lo']);
  }, 60_000);

  it('has no Docker socket and cannot reach the host filesystem', async () => {
    const out = exited(await node(`
      const fs = require('fs');
      console.log(JSON.stringify({
        sock: ['/var/run/docker.sock', '/run/docker.sock'].some((p) => fs.existsSync(p)),
        canaryDir: fs.existsSync(${JSON.stringify(canaryDir)}),
        canaryByName: fs.existsSync('/tmp/' + ${JSON.stringify(canaryDir.split(/[\\/]/).pop() ?? '')}),
        hostRoots: ['/host', '/mnt/host', '/mnt/c', '/Users', '/hostfs'].filter((p) => fs.existsSync(p)),
        shadow: (() => { try { fs.readFileSync('/etc/shadow'); return 'READ'; } catch (e) { return e.code; } })(),
        rootEnv: (() => { try { fs.readFileSync('/proc/1/environ'); return 'READ'; } catch (e) { return e.code; } })(),
      }));`));
    const result = JSON.parse(out.stdout) as Record<string, unknown>;
    expect(result).toMatchObject({ sock: false, canaryDir: false, canaryByName: false, hostRoots: [] });
    expect(JSON.stringify(result)).not.toContain('HOST-SECRET-CANARY');
  }, 60_000);

  it('does not inherit the backend environment (no keys, no secrets)', async () => {
    const out = exited(await node(`console.log(JSON.stringify(Object.keys(process.env).sort()))`));
    const names = JSON.parse(out.stdout) as string[];
    expect(names).not.toContain('GC_CANARY_SECRET');
    expect(names.filter((name) => /key|token|secret|passw|aws/i.test(name))).toEqual([]);
    expect(out.stdout).not.toContain('HOST-ENV-CANARY');
  }, 60_000);

  it('has a read-only root, a size-capped non-executable /tmp, and no other writable place', async () => {
    const out = exited(await node(`
      const fs = require('fs'); const r = {};
      const tryWrite = (p) => { try { fs.writeFileSync(p, 'x'); fs.unlinkSync(p); return 'WRITTEN'; } catch (e) { return e.code; } };
      r.etc = tryWrite('/etc/gc-pwn'); r.root = tryWrite('/gc-pwn'); r.opt = tryWrite('/opt/gc/apps/api/dist/pwn'); r.usr = tryWrite('/usr/bin/gc-pwn');
      try { fs.chmodSync('/opt/gc/apps/api/dist/sandbox/runner-main.js', 0o777); r.chmod = 'ALLOWED'; } catch (e) { r.chmod = e.code; }
      try { fs.writeFileSync('/tmp/x.sh', '#!/bin/sh\\necho hi\\n', { mode: 0o755 }); require('child_process').execFileSync('/tmp/x.sh'); r.execTmp = 'EXECUTED'; } catch (e) { r.execTmp = e.code || 'failed'; }
      try { fs.writeFileSync('/tmp/big', Buffer.alloc(32 * 1024 * 1024)); r.tmpBig = 'WRITTEN'; } catch (e) { r.tmpBig = e.code; }
      console.log(JSON.stringify(r));`, { tmpMb: 8 }));
    const result = JSON.parse(out.stdout) as Record<string, string>;
    expect(result).toMatchObject({ etc: 'EROFS', root: 'EROFS', opt: 'EROFS', usr: 'EROFS', tmpBig: 'ENOSPC' });
    expect(result.chmod).not.toBe('ALLOWED');
    expect(result.execTmp).not.toBe('EXECUTED');
  }, 60_000);

  it('limits the number of processes (fork bomb)', async () => {
    const out = exited(await node(`
      const { spawn } = require('child_process'); let started = 0; let failed = 0;
      for (let i = 0; i < 400; i += 1) {
        try { const c = spawn('sleep', ['30'], { stdio: 'ignore' }); c.on('error', () => {}); if (c.pid) started += 1; else failed += 1; } catch { failed += 1; }
      }
      setTimeout(() => { console.log(JSON.stringify({ started, failed })); process.exit(0); }, 500);`, { pids: 48 }));
    const { started, failed } = JSON.parse(out.stdout) as { started: number; failed: number };
    expect(started).toBeLessThan(48);
    expect(failed).toBeGreaterThan(300);
    await expectCleanedUp();
  }, 60_000);

  it('kills a process that exceeds the memory limit and cleans up', async () => {
    const out = exited(await node(`
      const keep = []; for (;;) keep.push(Buffer.alloc(40 * 1024 * 1024, 1)); `, { memoryMb: 256 }));
    expect(out.exitCode).not.toBe(0);
    expect(out.stdout).not.toContain('survived');
    await expectCleanedUp();
  }, 90_000);

  it('stops an infinite loop at the timeout and removes the container', async () => {
    const started = Date.now();
    const out = exited(await node('for (;;) {}', {}, { timeoutMs: 3_000 }));
    expect(out.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(15_000);
    await expectCleanedUp();
  }, 60_000);

  it('caps the CPU of a busy loop to the configured share', async () => {
    const out = exited(await node(`
      const t = Date.now(); let n = 0; const end = t + 3000;
      const workers = 4; const { Worker } = require('worker_threads');
      let done = 0; let total = 0;
      for (let i = 0; i < workers; i += 1) {
        const w = new Worker('const e=Date.now()+3000;let n=0;while(Date.now()<e)n++;require("worker_threads").parentPort.postMessage(n)', { eval: true });
        w.on('message', (v) => { total += v; if (++done === workers) console.log(JSON.stringify({ total })); });
      }`, { cpus: 0.5 }, { timeoutMs: 30_000 }));
    // 4 threads for 3 s on 0.5 CPU: the cgroup throttles them. Compare against an unthrottled run.
    const throttled = (JSON.parse(out.stdout) as { total: number }).total;
    const free = (JSON.parse(exited(await node(`
      const { Worker } = require('worker_threads'); let done = 0; let total = 0;
      for (let i = 0; i < 4; i += 1) { const w = new Worker('const e=Date.now()+3000;let n=0;while(Date.now()<e)n++;require("worker_threads").parentPort.postMessage(n)', { eval: true });
        w.on('message', (v) => { total += v; if (++done === 4) console.log(JSON.stringify({ total })); }); }`, { cpus: 2 }, { timeoutMs: 30_000 })).stdout) as { total: number }).total;
    expect(throttled).toBeLessThan(free * 0.7);
  }, 120_000);

  it('truncates output flooding and kills the container', async () => {
    const out = exited(await node(`const chunk = 'A'.repeat(65536); for (;;) process.stdout.write(chunk);`, {}, { max: 4096, timeoutMs: 30_000 }));
    expect(out.truncated).toBe(true);
    expect(out.stdout.length).toBeLessThanOrEqual(4096);
    await expectCleanedUp();
  }, 60_000);

  it('stops the container when the caller cancels', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 2_500);
    const started = Date.now();
    const out = exited(await node('setInterval(() => {}, 1000)', {}, { signal: controller.signal, timeoutMs: 60_000 }));
    expect(out.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(20_000);
    await expectCleanedUp();
  }, 60_000);

  it('removeStale() deletes containers left by a crashed backend', async () => {
    const name = `gc-sbx-${randomUUID()}`;
    docker('run', '-d', '--name', name, '--label', SANDBOX_LABEL, '--network=none', '--pull=never', '--entrypoint', 'node', base.image, '-e', 'setTimeout(()=>{},60000)');
    expect(leftovers().length).toBe(1);
    expect(await sandbox().removeStale()).toBe(1);
    expect(leftovers()).toEqual([]);
  }, 60_000);

  it('treats job data as data: shell metacharacters in the game code run nothing on the host', async () => {
    const marker = join(canaryDir, 'pwned');
    const evil = `"; touch ${marker} #\n$(touch ${marker})\n\`touch ${marker}\`\n../../../../etc/passwd`;
    const tester = new DockerGameTester(new DockerSandbox({ ...base, timeoutMs: 40_000 }));
    await tester.startup();
    const result = await tester.test(`function create(api){ /* ${evil.replace(/\*\//g, '')} */ api.status('x'); } function update(api, dt){}`, shooterPlan, never);
    // Reported by the game checks in the container (an empty game is not playable), never an infrastructure failure.
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(' ')).not.toMatch(/Sandbox/);
    expect(() => execFileSync('docker', ['version'])).not.toThrow();
    expect(await import('node:fs').then((fs) => fs.existsSync(marker))).toBe(false);
    await tester.dispose();
    await expectCleanedUp();
  }, 120_000);
});

describe.skipIf(!enabled)('Docker sandbox: Playwright game checks inside the container', () => {
  const fresh = (overrides: Partial<SandboxConfig> = {}) => new DockerGameTester(new DockerSandbox({ ...base, timeoutMs: 60_000, ...overrides }));
  beforeAll(() => { docker('image', 'inspect', base.image); });

  it('accepts a normal playable game (gameplay, keyboard, collision, restart checks)', async () => {
    const tester = fresh();
    await tester.startup();
    expect(tester.readiness().ready).toBe(true);
    const result = await tester.test(compile(shooterSource), shooterPlan, never);
    expect(result.errors).toEqual([]);
    await tester.dispose();
    await expectCleanedUp();
  }, 180_000);

  it('reports a JavaScript error thrown by the game', async () => {
    const tester = fresh();
    await tester.startup();
    const result = await tester.test('function create(api){ throw new Error("boom-from-game"); } function update(api, dt){}', shooterPlan, never);
    // The page error text itself travels back, not a generic sandbox failure.
    expect(result.errors.join(' ')).toContain('boom-from-game');
    expect(result.errors.join(' ')).not.toContain('Sandbox');
    await tester.dispose();
  }, 180_000);

  it('reports a game whose loop never returns (unresponsive page)', async () => {
    const tester = fresh();
    await tester.startup();
    const result = await tester.test('function create(api){ api.status("x"); } function update(api, dt){ for(;;){} }', shooterPlan, never);
    // Reported by the in-container tester (25 s browser deadline), before the 60 s container limit.
    expect(result.errors.join(' ')).toMatch(/25 giây|smoke test/);
    expect(result.errors.join(' ')).not.toContain('Sandbox dừng');
    await tester.dispose();
    await expectCleanedUp();
  }, 180_000);

  it('turns a container timeout into a repairable error and cleans up', async () => {
    const tester = fresh({ timeoutMs: 5_000 });
    await tester.startup();
    const result = await tester.test('function create(api){ api.status("x"); } function update(api, dt){ for(;;){} }', shooterPlan, never);
    expect(result.errors.join(' ')).toContain('vượt thời hạn');
    await tester.dispose();
    await expectCleanedUp();
  }, 180_000);

  it('stops the container immediately when the request is cancelled', async () => {
    const tester = fresh();
    await tester.startup();
    const controller = new AbortController();
    setTimeout(() => controller.abort(new AIError('cancelled', 'cancelled', 499)), 3_000);
    const started = Date.now();
    await expect(tester.test('function create(api){ api.status("x"); } function update(api, dt){ for(;;){} }', shooterPlan, controller.signal))
      .rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(20_000);
    await tester.dispose();
    await expectCleanedUp();
  }, 180_000);

  it('runs at most the configured number of containers at once', async () => {
    const box = new DockerSandbox({ ...base, concurrency: 1, timeoutMs: 60_000 });
    let current = 0; let peak = 0;
    const original = box.run.bind(box);
    box.run = async (request) => { current += 1; peak = Math.max(peak, current); try { return await original(request); } finally { current -= 1; } };
    const tester = new DockerGameTester(box);
    await tester.startup();
    const game = compile(shooterSource);
    const results = await Promise.all([tester.test(game, shooterPlan, never), tester.test(game, shooterPlan, never)]);
    expect(peak).toBe(1);
    // Both jobs ran to a game verdict (queued, not rejected or lost); the verdict itself is not this test's subject.
    expect(results).toHaveLength(2);
    expect(results.flatMap((r) => r.errors).join(' ')).not.toMatch(/Sandbox/);
    await tester.dispose();
    await expectCleanedUp();
  }, 240_000);

  it('keeps parallel jobs isolated: a broken game does not change another job result', async () => {
    const box = new DockerSandbox({ ...base, concurrency: 2, timeoutMs: 60_000 });
    const tester = new DockerGameTester(box);
    await tester.startup();
    const [good, bad] = await Promise.all([
      tester.test(compile(shooterSource), shooterPlan, never),
      tester.test('function create(api){ throw new Error("only-in-bad-job"); } function update(api, dt){}', shooterPlan, never),
    ]);
    expect(good.errors).toEqual([]);
    expect(bad.errors.join()).toContain('only-in-bad-job');
    expect(good.errors.join()).not.toContain('only-in-bad-job');
    await tester.dispose();
    await expectCleanedUp();
  }, 240_000);

  it('fails closed with tester_unavailable when Docker cannot be used (no host fallback)', async () => {
    const tester = new DockerGameTester(new DockerSandbox({ ...base, dockerBin: 'docker-binary-that-does-not-exist' }));
    await tester.startup();
    expect(tester.readiness().ready).toBe(false);
    await expect(tester.test(compile(shooterSource), shooterPlan, never)).rejects.toMatchObject({ code: 'tester_unavailable', status: 503 });
  }, 60_000);

  it('fails closed when the image is missing (pull is never attempted)', async () => {
    const tester = new DockerGameTester(new DockerSandbox({ ...base, image: 'gamecreator-sandbox:does-not-exist' }));
    await tester.startup();
    expect(tester.readiness().ready).toBe(false);
    await expect(tester.test(compile(shooterSource), shooterPlan, never)).rejects.toMatchObject({ code: 'tester_unavailable' });
  }, 60_000);
});
