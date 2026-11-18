// Advanced job queue end to end: real HTTP server, real NDJSON streams, real orchestrator
// and JobQueue. Only the AI provider and the browser tester are replaced.
import { once } from 'node:events';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentEventSchema, type AgentEvent } from '@game-creator/contracts';
import { CodeValidator } from '../src/agent/code-validator.js';
import type { GameTester, TesterReadiness, TestResult } from '../src/agent/game-tester.js';
import { AgentOrchestrator } from '../src/agent/orchestrator.js';
import { createApp } from '../src/app.js';
import { GameGenerationService } from '../src/services/game-generation-service.js';
import { JobQueue, type JobQueueOptions } from '../src/services/job-queue.js';
import { RequestBudget } from '../src/services/request-budget.js';
import { agentFixture } from './agent-fixtures.js';
import { mockProvider, mockRegistry } from './fixtures.js';

const body = JSON.stringify({ providerId: 'groq', prompt: 'Tạo máy bay có đạn và boss' });
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

/** A browser tester whose jobs finish only when the test says so. */
class GateTester implements GameTester {
  calls = 0; signals: AbortSignal[] = []; state: TesterReadiness = { ready: true, message: '' };
  private waiters: Array<() => void> = [];
  dispose = vi.fn(async () => {});
  readiness() { return this.state; }
  test(_js: string, _plan: unknown, signal: AbortSignal): Promise<TestResult> {
    this.calls += 1; this.signals.push(signal);
    return new Promise((resolve, reject) => {
      this.waiters.push(() => resolve({ errors: [] }));
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }
  releaseNext() { this.waiters.shift()?.(); }
}

async function start(queue: JobQueueOptions, tester: GateTester = new GateTester(), budget = new RequestBudget({ requestsPerMinute: 1000, requestsPerDay: 100_000, maxConcurrent: 100 })) {
  const service = new GameGenerationService(mockRegistry([mockProvider('groq', (input) => agentFixture(input))]), budget);
  const jobs = new JobQueue(queue);
  const agent = new AgentOrchestrator(service, tester, new CodeValidator(), undefined, jobs);
  const server = createApp({ generationService: service, agent, advancedEnabled: true }).listen(0, '127.0.0.1');
  servers.push(server);
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  const url = `http://127.0.0.1:${address.port}`;
  return { url, jobs, agent, tester, post: () => open(url) };
}

async function open(url: string, controller = new AbortController()) {
  const response = await fetch(`${url}/api/agent/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal });
  const events: AgentEvent[] = []; const raw: string[] = [];
  const finished = response.status === 200 ? (async () => {
    const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (line) { raw.push(line); events.push(AgentEventSchema.parse(JSON.parse(line))); }
        }
      }
    } catch { /* aborted by the test */ }
  })() : Promise.resolve();
  return { response, events, raw, finished, controller };
}
const last = (events: AgentEvent[]) => events.at(-1);
const waiting = (events: AgentEvent[]) => events.filter((event) => event.type === 'status' && /chờ đến lượt/.test(event.message));

describe('Advanced job queue over HTTP', () => {
  it('queues a second job, tells it its place, runs it after the first, and keeps each NDJSON stream ordered', async () => {
    const h = await start({ concurrency: 1, maxQueue: 1, runTimeoutMs: 20_000, maxWaitMs: 20_000 });
    const first = await h.post();
    await vi.waitFor(() => expect(h.tester.calls).toBe(1));
    const second = await h.post();
    expect(second.response.status).toBe(200);
    await vi.waitFor(() => expect(waiting(second.events)).toHaveLength(1));
    expect(waiting(second.events)[0]).toMatchObject({ type: 'status', stage: 'Planning', message: expect.stringContaining('vị trí 1') });
    expect(h.tester.calls).toBe(1); // the second job has not touched the browser
    expect(h.jobs.stats()).toEqual({ running: 1, waiting: 1, closed: false });

    h.tester.releaseNext(); await first.finished;
    expect(last(first.events)?.type).toBe('completed');
    await vi.waitFor(() => expect(h.tester.calls).toBe(2));
    h.tester.releaseNext(); await second.finished;
    expect(last(second.events)?.type).toBe('completed');

    // Every line was one valid event; the first event of each stream is a status, the last is terminal.
    for (const stream of [first, second]) {
      expect(stream.events[0]?.type).toBe('status');
      expect(stream.events.filter((event) => event.type === 'completed' || event.type === 'failed')).toHaveLength(1);
      expect(stream.raw.every((line) => line.startsWith('{') && line.endsWith('}'))).toBe(true);
    }
    expect(waiting(first.events)).toHaveLength(0);
    expect(h.jobs.stats()).toEqual({ running: 0, waiting: 0, closed: false });
  }, 30_000);

  it('answers a flood: one runs, the queue fills, everything else is a plain 429 before any stream starts', async () => {
    const h = await start({ concurrency: 1, maxQueue: 2, runTimeoutMs: 20_000, maxWaitMs: 20_000 });
    const first = await h.post();
    await vi.waitFor(() => expect(h.tester.calls).toBe(1));
    const rest = await Promise.all(Array.from({ length: 19 }, () => h.post()));
    const accepted = rest.filter((stream) => stream.response.status === 200);
    const rejected = rest.filter((stream) => stream.response.status === 429);
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(17);
    for (const stream of rejected) {
      expect(stream.response.headers.get('content-type')).toContain('application/json');
      expect(stream.response.headers.get('content-type')).not.toContain('ndjson');
      expect(Number(stream.response.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(await stream.response.json()).toMatchObject({ error: { code: 'rate_limit' } });
    }
    expect(h.jobs.stats()).toEqual({ running: 1, waiting: 2, closed: false });
    expect(h.tester.calls).toBe(1);

    // They drain in order and the queue ends empty (nothing leaked).
    for (const stream of [first, ...accepted]) { await vi.waitFor(() => expect(h.tester.calls).toBeGreaterThan(0)); h.tester.releaseNext(); await vi.waitFor(() => expect(last(stream.events)?.type).toBe('completed')); }
    expect(h.tester.calls).toBe(3);
    expect(h.jobs.stats()).toEqual({ running: 0, waiting: 0, closed: false });
  }, 40_000);

  it('with the default no-queue setting a busy server answers 429 immediately (legacy behaviour)', async () => {
    const h = await start({ concurrency: 1, maxQueue: 0, runTimeoutMs: 20_000 });
    const first = await h.post();
    await vi.waitFor(() => expect(h.tester.calls).toBe(1));
    const second = await h.post();
    expect(second.response.status).toBe(429);
    expect(await second.response.json()).toMatchObject({ error: { code: 'rate_limit', message: expect.stringContaining('đang xử lý một game') } });
    first.controller.abort(); await first.finished;
  }, 20_000);

  it('releases a waiting job\'s place when its client disconnects, and the next client can use it', async () => {
    const h = await start({ concurrency: 1, maxQueue: 1, runTimeoutMs: 20_000, maxWaitMs: 20_000 });
    const first = await h.post();
    await vi.waitFor(() => expect(h.tester.calls).toBe(1));
    const second = await h.post();
    await vi.waitFor(() => expect(h.jobs.stats().waiting).toBe(1));
    expect((await h.post()).response.status).toBe(429); // full
    second.controller.abort(); await second.finished;
    await vi.waitFor(() => expect(h.jobs.stats().waiting).toBe(0));
    const third = await h.post();
    expect(third.response.status).toBe(200);
    await vi.waitFor(() => expect(h.jobs.stats().waiting).toBe(1));
    expect(h.tester.calls).toBe(1); // the disconnected job never reached the browser
    first.controller.abort(); third.controller.abort();
    await vi.waitFor(() => expect(h.jobs.stats()).toEqual({ running: 0, waiting: 0, closed: false }));
  }, 20_000);

  it('cancels a running job when its client disconnects: the tester is aborted and the slot is freed', async () => {
    const h = await start({ concurrency: 1, maxQueue: 0, runTimeoutMs: 20_000 });
    const first = await h.post();
    await vi.waitFor(() => expect(h.tester.calls).toBe(1));
    first.controller.abort(); await first.finished;
    await vi.waitFor(() => expect(h.tester.signals[0]!.aborted).toBe(true));
    await vi.waitFor(() => expect(h.jobs.stats().running).toBe(0));
  }, 20_000);

  it('enforces the per-job timeout: the tester is aborted and the client gets a timeout event', async () => {
    const h = await start({ concurrency: 1, maxQueue: 0, runTimeoutMs: 1_500 });
    const first = await h.post();
    await first.finished;
    expect(last(first.events)).toMatchObject({ type: 'failed', error: { code: 'timeout', message: expect.stringContaining('hết thời hạn') } });
    expect(h.tester.signals[0]!.aborted).toBe(true);
    expect(h.jobs.stats()).toEqual({ running: 0, waiting: 0, closed: false });
  }, 20_000);

  it('drops a job that waits longer than the wait limit with a 429 event', async () => {
    const h = await start({ concurrency: 1, maxQueue: 1, runTimeoutMs: 20_000, maxWaitMs: 1_000 });
    const first = await h.post();
    await vi.waitFor(() => expect(h.tester.calls).toBe(1));
    const second = await h.post(); await second.finished;
    expect(last(second.events)).toMatchObject({ type: 'failed', error: { code: 'rate_limit' } });
    expect(h.jobs.stats()).toEqual({ running: 1, waiting: 0, closed: false });
    first.controller.abort(); await first.finished;
  }, 20_000);

  it('graceful shutdown: running and waiting jobs end with a shutting_down event, new requests get 503, sandbox is disposed', async () => {
    const h = await start({ concurrency: 1, maxQueue: 1, runTimeoutMs: 20_000, maxWaitMs: 20_000 });
    const first = await h.post();
    await vi.waitFor(() => expect(h.tester.calls).toBe(1));
    const second = await h.post();
    await vi.waitFor(() => expect(h.jobs.stats().waiting).toBe(1));
    await h.agent.shutdown(0);
    await Promise.all([first.finished, second.finished]);
    expect(last(first.events)).toMatchObject({ type: 'failed', error: { code: 'shutting_down' } });
    expect(last(second.events)).toMatchObject({ type: 'failed', error: { code: 'shutting_down' } });
    expect(h.tester.signals[0]!.aborted).toBe(true);
    expect(h.tester.dispose).toHaveBeenCalledOnce();
    const late = await h.post();
    expect(late.response.status).toBe(503);
    expect(await late.response.json()).toMatchObject({ error: { code: 'shutting_down' } });
    expect(h.jobs.stats()).toEqual({ running: 0, waiting: 0, closed: true });
  }, 20_000);

  it('answers 503 before streaming, and reports Advanced as disabled, while the sandbox is not ready', async () => {
    const tester = new GateTester(); tester.state = { ready: false, message: 'Docker sandbox không đạt kiểm tra cách ly.' };
    const h = await start({ concurrency: 1, maxQueue: 1, runTimeoutMs: 20_000 }, tester);
    const attempt = await h.post();
    expect(attempt.response.status).toBe(503);
    expect(await attempt.response.json()).toMatchObject({ error: { code: 'tester_unavailable', message: expect.stringContaining('Docker sandbox') } });
    const config = await (await fetch(`${h.url}/api/agent/config`)).json() as { enabled: boolean; message: string };
    expect(config).toMatchObject({ enabled: false, message: expect.stringContaining('Docker sandbox') });
    expect(tester.calls).toBe(0);
    expect(h.jobs.stats()).toEqual({ running: 0, waiting: 0, closed: false });

    tester.state = { ready: true, message: '' };
    expect((await (await fetch(`${h.url}/api/agent/config`)).json() as { enabled: boolean }).enabled).toBe(true);
  }, 20_000);

  it('does not spend AI budget on a request that the queue rejects', async () => {
    const budget = new RequestBudget({ requestsPerMinute: 1000, requestsPerDay: 100_000, maxConcurrent: 100 });
    const acquire = vi.spyOn(budget, 'acquire');
    const h = await start({ concurrency: 1, maxQueue: 0, runTimeoutMs: 20_000 }, new GateTester(), budget);
    const first = await h.post();
    await vi.waitFor(() => expect(h.tester.calls).toBe(1));
    const spent = acquire.mock.calls.length;
    for (let i = 0; i < 5; i += 1) expect((await h.post()).response.status).toBe(429);
    expect(acquire.mock.calls.length).toBe(spent);
    first.controller.abort(); await first.finished;
  }, 20_000);
});

describe('per-client limit on queued Advanced jobs', () => {
  it('stops one address from filling the queue', async () => {
    const h = await start({ concurrency: 1, maxQueue: 5, runTimeoutMs: 20_000, maxWaitMs: 20_000, maxPerOwner: 2 });
    const first = await h.post();
    await vi.waitFor(() => expect(h.tester.calls).toBe(1));
    const second = await h.post();
    expect(second.response.status).toBe(200);
    const third = await h.post();
    expect(third.response.status).toBe(429);
    expect(await third.response.json()).toMatchObject({ error: { code: 'rate_limit' } });
    first.controller.abort(); second.controller.abort();
  }, 20_000);
});
