import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { GenerateShooterResponseSchema } from '@game-creator/contracts';
import { createApp } from '../src/app.js';
import { ProviderRegistry } from '../src/providers/provider-registry.js';
import { createProviderRegistry } from '../src/providers/create-registry.js';
import { MODEL_CATALOG } from '../src/providers/model-catalog.js';
import { AIError } from '../src/providers/errors.js';
import { AiGateway } from '../src/services/ai-gateway.js';
import { RequestBudget } from '../src/services/request-budget.js';
import { normalizeProviderError } from '../src/providers/errors.js';
import { compileAndGate } from '../src/shooter/compile-job.js';
import { SHOOTER_BRIEF_SYSTEM_PROMPT } from '../src/shooter/prompt.js';
import { ShooterService } from '../src/shooter/service.js';
import { mockProvider, mockRegistry, sampleBrief } from './fixtures.js';

const selection = { providerId: 'gemini', modelId: 'gemini-3.5-flash-lite' };
const input = { ...selection, prompt: 'Sinh tồn trong thành phố zombie, súng bắn nhanh' };
const signal = () => new AbortController().signal;
const gateway = () => new AiGateway(mockRegistry());
// The compiler runs in this process here: the worker (time limit, abort) is tested in shooter-service.test.ts.
const shooterOn = (aiGateway: AiGateway) => new ShooterService(aiGateway, { compile: async (job) => compileAndGate(job), seed: () => 7 });
const appOn = (aiGateway: AiGateway) => createApp({ gateway: aiGateway, shooterService: shooterOn(aiGateway) });
const shoot = (app: ReturnType<typeof createApp>, body: object) => request(app).post('/api/shooter/generate').send(body);

describe('ProviderRegistry', () => {
  it('declares only verified free-tier models, with the cheapest as default', () => {
    expect(MODEL_CATALOG.gemini?.map((item) => item.id)).toEqual(['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash']);
    expect(MODEL_CATALOG.groq?.map((item) => item.id)).toEqual(['openai/gpt-oss-20b', 'openai/gpt-oss-120b']);
  });

  it('configures each provider with only an API key and resolves a server default per request', () => {
    const registry = createProviderRegistry({ GEMINI_API_KEY: 'test-key', GROQ_API_KEY: 'test-key' });
    expect(registry.list()).toMatchObject([
      { id: 'gemini', available: true, reason: null, defaultModelId: 'gemini-3.5-flash-lite' },
      { id: 'groq', available: true, reason: null, defaultModelId: 'openai/gpt-oss-20b' },
    ]);
    expect(registry.resolve('groq').model.id).toBe('openai/gpt-oss-20b');
    expect(registry.resolve('gemini', 'auto').model.id).toBe('gemini-3.5-flash-lite');
    expect(registry.resolve('groq', 'openai/gpt-oss-120b').model.id).toBe('openai/gpt-oss-120b');
    expect(registry.resolve('gemini', 'gemini-3.8-flash').model.id).toBe('gemini-3.8-flash');
  });

  it('lets *_ALLOWED_MODELS narrow the catalog, treating an empty value as the full catalog', () => {
    const narrowed = createProviderRegistry({ GEMINI_API_KEY: 'test-key', GEMINI_ALLOWED_MODELS: ' gemini-3.8-flash ' });
    expect(narrowed.list()[0]).toMatchObject({ available: true, defaultModelId: 'gemini-3.8-flash', models: [{ id: 'gemini-3.8-flash' }] });
    expect(narrowed.resolve('gemini').model.id).toBe('gemini-3.8-flash');
    expect(() => narrowed.resolve('gemini', 'gemini-3.5-flash-lite')).toThrow(expect.objectContaining({ code: 'invalid_model' }));
    const empty = createProviderRegistry({ GROQ_API_KEY: 'test-key', GROQ_ALLOWED_MODELS: '' });
    expect(empty.list()[1]?.models).toHaveLength(2);
  });

  it('resolves each request independently and returns copies of metadata', () => {
    const registry = mockRegistry();
    const gemini = registry.resolve(selection.providerId, selection.modelId);
    const groq = registry.resolve('groq', 'openai/gpt-oss-120b');
    expect(gemini.provider.id).toBe('gemini');
    expect(groq.provider.id).toBe('groq');
    expect(groq.model.capabilities.outputMode).toBe('json_schema');
    gemini.model.id = 'mutated';
    expect(registry.resolve(selection.providerId, selection.modelId).model.id).toBe(selection.modelId);
  });

  it.each([
    ['unknown', selection.modelId, 'invalid_provider'],
    ['gemini', 'gemini-4-argon', 'invalid_model'],
    ['gemini', 'gemini-2.5-flash', 'invalid_model'],
    ['groq', 'llama-3.3-70b-versatile', 'invalid_model'],
    ['gemini', 'openai/gpt-oss-20b', 'invalid_model'],
  ])('rejects %s / %s', (providerId, modelId, code) => {
    expect(() => mockRegistry().resolve(providerId!, modelId!)).toThrow(expect.objectContaining({ code }));
  });

  it('reports missing keys without exposing configured secrets', () => {
    const registry = createProviderRegistry({ GEMINI_API_KEY: 'secret-test-key' });
    const descriptions = registry.list();
    expect(descriptions.find((item) => item.id === 'gemini')).toMatchObject({ available: true, reason: null });
    expect(descriptions.find((item) => item.id === 'groq')).toMatchObject({ available: false, reason: 'missing_key' });
    expect(JSON.stringify(descriptions)).not.toContain('secret-test-key');
    expect(() => registry.resolve('groq')).toThrow(expect.objectContaining({ code: 'missing_key', status: 503 }));
  });

  it('rejects unsupported or paid IDs even when env explicitly includes them', () => {
    const registry = createProviderRegistry({ GEMINI_API_KEY: 'test-key', GEMINI_ALLOWED_MODELS: `${selection.modelId},gemini-4-argon` });
    expect(registry.list()[0]).toMatchObject({ available: false, reason: 'invalid_model' });
    expect(() => registry.resolve(selection.providerId, selection.modelId)).toThrow(expect.objectContaining({ code: 'invalid_model' }));
  });

  it('rejects duplicate registrations', () => {
    const registration = { provider: mockProvider(), configured: true, models: MODEL_CATALOG.gemini ?? [] };
    expect(() => new ProviderRegistry([registration, registration])).toThrow('Duplicate');
  });
});
describe('Provider error normalization', () => {
  it.each([
    [{ status: 429, headers: new Headers({ 'retry-after': '7' }) }, 'rate_limit', 7],
    [{ status: 429, message: '{"error":{"details":[{"retryDelay":"29s"}]}}' }, 'rate_limit', 29],
    [{ status: 429 }, 'rate_limit', 60],
    [{ status: 413, headers: new Headers() }, 'rate_limit', 60],
  ])('maps quota/TPM errors with a bounded Retry-After %#', (error, code, seconds) => {
    expect(normalizeProviderError(error)).toMatchObject({ code, status: 429, retryAfterSeconds: seconds });
  });
  it.each([
    [{ status: 400, error: { code: 'json_validate_failed', failed_generation: '{"code":"alert(1)"}' } }, 'invalid_game_spec', 422],
    [{ status: 503, message: 'overloaded' }, 'provider_error', 502],
    [{ name: 'APIConnectionTimeoutError' }, 'timeout', 504],
    [{ status: 403 }, 'provider_error', 502],
  ])('maps %j without forwarding upstream text', (error, code, status) => {
    const normalized = normalizeProviderError(error);
    expect(normalized).toMatchObject({ code, status });
    expect(normalized.message).not.toContain('alert');
    expect(normalized.message).not.toContain('overloaded');
  });
});
describe('AI HTTP and generation through the gateway', () => {
  it.each([['gemini', 'gemini-3.5-flash-lite'], ['groq', 'openai/gpt-oss-20b']])(
    'uses the %s server default when the request has no model field', async (providerId, modelId) => {
      const app = appOn(gateway());
      const connection = await request(app).post('/api/ai/test-connection').send({ providerId }).expect(200);
      expect(connection.body.modelId).toBe(modelId);
      const game = await shoot(app, { prompt: 'Create a zombie shooter', providerId }).expect(201);
      expect(game.body.data).toMatchObject({ provider: providerId, modelId });
    }, 60_000,
  );
  it('lists configuration without calling provider methods', async () => {
    const provider = mockProvider();
    const generate = vi.spyOn(provider, 'generate');
    const connect = vi.spyOn(provider, 'testConnection');
    const app = appOn(new AiGateway(mockRegistry([provider])));
    await request(app).get('/api/ai/providers').expect(200);
    expect(generate).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled();
    await request(app).post('/api/ai/test-connection').send(selection).expect(200);
    expect(connect).toHaveBeenCalledOnce(); expect(generate).not.toHaveBeenCalled();
  });

  it('generates validated games through either provider, preserving per-request selection', async () => {
    const app = appOn(gateway());
    const [a, b] = await Promise.all([
      shoot(app, input),
      shoot(app, { ...input, providerId: 'groq', modelId: 'openai/gpt-oss-120b', prompt: 'Create a zombie shooter' }),
    ]);
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    const gameA = GenerateShooterResponseSchema.parse(a.body).data;
    const gameB = GenerateShooterResponseSchema.parse(b.body).data;
    expect(gameA.provider).toBe('gemini'); expect(gameB.provider).toBe('groq');
    expect(gameA.modelId).toBe(selection.modelId);
    expect(gameB.modelId).toBe('openai/gpt-oss-120b');
    expect(gameA.id).not.toBe(gameB.id); expect(gameA.prompt).toBe(input.prompt);
  }, 60_000);

  it('passes the system prompt, provider schema and user prompt to the adapter', async () => {
    const provider = mockProvider();
    const generate = vi.spyOn(provider, 'generate');
    await shooterOn(new AiGateway(mockRegistry([provider]))).generate(input, 'a', signal());
    const call = generate.mock.calls[0]?.[0];
    expect(call).toMatchObject({ prompt: input.prompt, systemPrompt: SHOOTER_BRIEF_SYSTEM_PROMPT, model: { id: selection.modelId } });
    expect(call?.jsonSchema).toMatchObject({ type: 'object', additionalProperties: false });
  }, 60_000);

  it.each([
    [{ ...input, providerId: 'unknown' }, 'invalid_provider', 400],
    [{ ...input, modelId: 'not-allowed' }, 'invalid_model', 400],
    [{ ...input, providerId: 'groq', modelId: 'llama-3.3-70b-versatile' }, 'invalid_model', 400],
    [{ prompt: 'game', modelId: selection.modelId }, 'invalid_model', 400],
    [{ prompt: 'game', providerId: 'demo', modelId: 'other' }, 'invalid_model', 400],
  ])('rejects invalid selection %#', async (body, code, status) => {
    const response = await shoot(appOn(gateway()), body).expect(status as number);
    expect(response.body.error.code).toBe(code);
  });

  it('keeps missing-key providers unavailable and responds without crashing', async () => {
    const app = appOn(new AiGateway(createProviderRegistry({})));
    const response = await shoot(app, input).expect(503);
    expect(response.body.error.code).toBe('missing_key');
    await request(app).get('/api/health').expect(200);
  });

  it('returns structured validation errors and never silently retries', async () => {
    const provider = mockProvider('gemini', vi.fn(async () => '{"code":"secret output"}'));
    const app = appOn(new AiGateway(mockRegistry([provider])));
    const response = await shoot(app, input).expect(422);
    expect(response.body.error.code).toBe('invalid_brief');
    expect(response.body.error.issues.length).toBeGreaterThan(0);
    for (const issue of response.body.error.issues) {
      expect(Object.keys(issue).sort()).toEqual(['code', 'message', 'path']);
      expect(issue.message).toEqual(expect.any(String));
      expect(issue.message).not.toContain('secret output');
    }
    expect(JSON.stringify(response.body)).not.toContain('secret output');
    expect(provider.generate).toHaveBeenCalledOnce();
  });

  it.each([[429, 'rate_limit', 429], [413, 'rate_limit', 429], [401, 'provider_error', 502], [500, 'provider_error', 502], [404, 'invalid_model', 400]] as const)(
    'normalizes provider %i without falling back or leaking details', async (upstream, code, status) => {
      const provider = mockProvider('gemini', vi.fn(async () => { throw { status: upstream, message: 'API key=private-value' }; }));
      const fallback = mockProvider('groq', vi.fn(async () => JSON.stringify(sampleBrief())));
      const app = appOn(new AiGateway(mockRegistry([provider, fallback])));
      const response = await shoot(app, input).expect(status);
      expect(response.body.error.code).toBe(code); expect(JSON.stringify(response.body)).not.toContain('private-value');
      expect(provider.generate).toHaveBeenCalledOnce(); expect(fallback.generate).not.toHaveBeenCalled();
      if (status === 429) expect(response.headers['retry-after']).toBe('60');
    },
  );

  const artifact = { prompt: input.prompt, systemPrompt: 'system', jsonSchema: {} };

  it('aborts timed out generation and releases the concurrency slot', async () => {
    let aborted = false;
    const provider = mockProvider('gemini', (call) => new Promise((_resolve, reject) => {
      call.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
    }));
    const budget = new RequestBudget({ maxConcurrent: 1 });
    const generator = new AiGateway(mockRegistry([provider]), budget, 20);
    await expect(generator.generateArtifact(selection, artifact, 'a', signal())).rejects.toMatchObject({ code: 'timeout' });
    expect(aborted).toBe(true);
    const release = budget.acquire('b'); release();
  });

  it('cancels a disconnected client request', async () => {
    const controller = new AbortController();
    const provider = mockProvider('gemini', async () => new Promise(() => {}));
    const pending = new AiGateway(mockRegistry([provider])).generateArtifact(selection, artifact, 'a', controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('returns Retry-After for the shared connection/generation budget', async () => {
    const app = appOn(new AiGateway(mockRegistry(), new RequestBudget({ requestsPerMinute: 1 })));
    await request(app).post('/api/ai/test-connection').send(selection).expect(200);
    const response = await shoot(app, input).expect(429);
    expect(response.body.error.code).toBe('rate_limit');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('RequestBudget', () => {
  it('enforces concurrent work and safely releases only once', () => {
    const budget = new RequestBudget({ maxConcurrent: 1 });
    const release = budget.acquire('a');
    expect(() => budget.acquire('b')).toThrow(AIError);
    release(); release();
    const next = budget.acquire('b');
    expect(() => budget.acquire('c')).toThrow(AIError);
    next();
  });
  it('expires minute windows but retains the global daily budget', () => {
    let now = 0;
    const budget = new RequestBudget({ requestsPerMinute: 1, requestsPerDay: 2, now: () => now });
    budget.acquire('a')();
    expect(() => budget.acquire('a')).toThrow(AIError);
    now = 60001; budget.acquire('a')();
    expect(() => budget.acquire('b')).toThrow(expect.objectContaining({ code: 'rate_limit' }));
    now = 86400001;
    expect(() => budget.acquire('a')()).not.toThrow();
  });
});
