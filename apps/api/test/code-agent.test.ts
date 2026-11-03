import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { AgentEventSchema, type AgentEvent, type AgentRequest } from '@game-creator/contracts';
import { CodeValidator } from '../src/agent/code-validator.js';
import { AgentOrchestrator } from '../src/agent/orchestrator.js';
import { GameGenerationService } from '../src/services/game-generation-service.js';
import { RequestBudget } from '../src/services/request-budget.js';
import { AIError } from '../src/providers/errors.js';
import { createApp } from '../src/app.js';
import { IsolatedCodeValidator } from '../src/agent/isolated-validator.js';
import { mockProvider, mockRegistry } from './fixtures.js';
import { paddleSource, shooterSource, shooterPlan, runtimeErrorSource } from './agent-fixtures.js';

const validator = new CodeValidator();
const input: AgentRequest = { providerId: 'groq', prompt: 'Tạo máy bay có đạn và boss' };
function harness(outputs: Array<string | Error>, testErrors: string[][] = [[]], budget = new RequestBudget({ requestsPerMinute: 100 })) {
  const generate = vi.fn(async () => { const next = outputs.shift(); if (next instanceof Error) throw next; return next ?? ''; });
  const service = new GameGenerationService(mockRegistry([mockProvider('groq', generate)]), budget);
  const test = vi.fn(async () => ({ errors: testErrors.shift() ?? [] }));
  const agent = new AgentOrchestrator(service, { test }, validator);
  const events: AgentEvent[] = [];
  return { generate, test, agent, service, events, run: async () => {
    const reservation = agent.reserve(input);
    try { await agent.run(reservation.request, 'test', new AbortController().signal, (event) => { expect(AgentEventSchema.safeParse(event).success).toBe(true); events.push(event); }); }
    finally { reservation.release(); }
  } };
}
const code = (source = shooterSource) => JSON.stringify({ source });

describe('CodeValidator', () => {
  it('compiles inside a bounded worker without executing source', async () => {
    const result = await new IsolatedCodeValidator().validate(shooterSource, new AbortController().signal);
    expect(result.errors).toEqual([]);
    expect(result.javascript).toContain('__budget();');
  }, 10000);
  it.each([shooterSource, paddleSource])('compiles distinct mechanics with the restricted API', (source) => {
    const result = validator.validate(source);
    expect(result.errors).toEqual([]);
    expect(result.javascript).toContain('__budget();');
    expect(result.javascript).not.toContain(': GameAPI');
  });
  it('reports syntax errors and type errors', () => {
    expect(validator.validate('function create(api: GameAPI) { const x = ; }').errors.length).toBeGreaterThan(0);
    expect(validator.validate('function create(api: GameAPI) { api.spawn("x", "bad", 20, 20, 20, 1); } function update(api: GameAPI, dt: number) {}').errors.join()).toContain('string');
  });
  it.each([
    'fetch("https://bad.test")', 'window.location.href = "https://bad.test"', 'localStorage.getItem("key")',
    'api.spawn.constructor("return globalThis")()', 'api.spawn["constructor"]("return globalThis")()',
    'const a = [api.spawn]; const k = "constructor"; a[0]![k]()', 'eval("1")', 'new Worker("x")',
    'try { while (true) {} } catch (e) {}', 'const a: any = api', 'const a = api as unknown',
    'const a = [1]; a.length = 100000000', 'let s = "x"; for (let i=0;i<100;i++) { s += s; }',
    'const a = [1]; a.push(...a)', 'import("node:fs")', 'api.state["__proto__"] = 2',
    'const mathAlias = Math; mathAlias.min = () => 1000000',
  ])('rejects forbidden capabilities: %s', (body) => {
    expect(validator.validate(`function create(api: GameAPI): void { ${body}; } function update(api: GameAPI, dt: number): void {}`).errors.length).toBeGreaterThan(0);
  });
  it('does not execute top-level code in Node', () => {
    expect(validator.validate('process.exit(1);').errors.length).toBeGreaterThan(0);
  });
  it('bounds source size and requires both entrypoints', () => {
    expect(validator.validate('x'.repeat(25000)).errors).toHaveLength(1);
    expect(validator.validate('function create(api: GameAPI) {}').errors.join()).toContain('update');
  });
});

describe('AgentOrchestrator', () => {
  it('plans, compiles and tests with the selected provider/model, without extra calls', async () => {
    const h = harness([JSON.stringify(shooterPlan), code()]); await h.run();
    expect(h.generate).toHaveBeenCalledTimes(2); expect(h.test).toHaveBeenCalledOnce();
    expect(h.events.at(-1)).toMatchObject({ type: 'completed', project: { provider: 'groq', modelId: 'openai/gpt-oss-20b', repairs: 0 } });
  });
  it('repairs syntax errors before invoking the browser', async () => {
    const h = harness([JSON.stringify(shooterPlan), code('broken {'), code()]); await h.run();
    expect(h.generate).toHaveBeenCalledTimes(3); expect(h.test).toHaveBeenCalledOnce();
    expect(h.events.at(-1)).toMatchObject({ type: 'completed', project: { repairs: 1 } });
  });
  it('feeds runtime diagnostics back to repair and tests the corrected source', async () => {
    const h = harness([JSON.stringify(shooterPlan), code(runtimeErrorSource), code()], [['Runtime error at create'], []]); await h.run();
    expect(h.test).toHaveBeenCalledTimes(2); expect(h.generate).toHaveBeenCalledTimes(3);
    expect(h.events.at(-1)).toMatchObject({ type: 'completed', project: { repairs: 1 } });
  });
  it('stops after exactly two repairs and never returns a failed artifact', async () => {
    const h = harness([JSON.stringify(shooterPlan), code(), code(), code()], [['runtime'], ['runtime'], ['runtime']]); await h.run();
    expect(h.generate).toHaveBeenCalledTimes(4); expect(h.test).toHaveBeenCalledTimes(3);
    expect(h.events.at(-1)).toMatchObject({ type: 'failed', error: { code: 'agent_failed' } });
    expect(h.events.some((event) => event.type === 'completed')).toBe(false);
  });
  it.each([429, 401, 403])('stops on upstream %i without repair/retry/fallback', async (status) => {
    const h = harness([JSON.stringify(shooterPlan), Object.assign(new Error('secret upstream'), { status })]); await h.run();
    expect(h.generate).toHaveBeenCalledTimes(2); expect(h.test).not.toHaveBeenCalled();
    expect(h.events.at(-1)?.type).toBe('failed'); expect(JSON.stringify(h.events)).not.toContain('secret upstream');
  });
  it('counts every AI step against the shared request budget', async () => {
    const h = harness([JSON.stringify(shooterPlan), code()], [[]], new RequestBudget({ requestsPerMinute: 1 })); await h.run();
    expect(h.generate).toHaveBeenCalledOnce(); expect(h.events.at(-1)).toMatchObject({ type: 'failed', error: { code: 'rate_limit' } });
  });
  it('limits active jobs and releases its slot', () => {
    const h = harness([]); const reserved = h.agent.reserve(input);
    expect(() => h.agent.reserve(input)).toThrow(expect.objectContaining({ code: 'rate_limit' }));
    reserved.release(); expect(() => h.agent.reserve(input)).not.toThrow();
  });
  it('does not attempt AI repair for a missing browser installation', async () => {
    const h = harness([JSON.stringify(shooterPlan), code()]);
    h.test.mockRejectedValueOnce(new AIError('tester_unavailable', 'Install Chromium', 503)); await h.run();
    expect(h.generate).toHaveBeenCalledTimes(2); expect(h.events.at(-1)).toMatchObject({ type: 'failed', error: { code: 'tester_unavailable' } });
  });
});

describe('Advanced API local-only boundary', () => {
  it('streams validated events while keeping Standard available', async () => {
    const h = harness([JSON.stringify(shooterPlan), code()]);
    const app = createApp({ generationService: h.service, agent: h.agent, advancedEnabled: true });
    const response = await request(app).post('/api/agent/generate').send(input).expect(200);
    const events = response.text.trim().split('\n').map((line) => AgentEventSchema.parse(JSON.parse(line)));
    expect(events.at(-1)?.type).toBe('completed');
    await request(app).post('/api/games/generate').send({ prompt: 'demo' }).expect(201);
  });
  it('rejects remote Host/Origin and explicit disable before any AI call', async () => {
    const h = harness([]);
    const app = createApp({ generationService: h.service, agent: h.agent, advancedEnabled: true });
    await request(app).post('/api/agent/generate').set('Host', 'public.example').send(input).expect(403);
    await request(app).post('/api/agent/generate').set('Origin', 'https://evil.test').send(input).expect(403);
    await request(createApp({ generationService: h.service, agent: h.agent, advancedEnabled: false })).post('/api/agent/generate').send(input).expect(403);
    expect(h.generate).not.toHaveBeenCalled();
  });
});
