import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { GameSpecSchema, GenerateGameResponseSchema } from '@game-creator/contracts';
import { createApp } from '../src/app.js';
import { ProviderRegistry } from '../src/providers/provider-registry.js';
import { createProviderRegistry } from '../src/providers/create-registry.js';
import { MODEL_CATALOG } from '../src/providers/model-catalog.js';
import { AIError } from '../src/providers/errors.js';
import { GameGenerationService, parseGameSpec } from '../src/services/game-generation-service.js';
import { RequestBudget } from '../src/services/request-budget.js';
import { mockProvider, mockRegistry, sampleSpec } from './fixtures.js';

const selection = { providerId: 'gemini', modelId: 'gemini-2.5-flash-lite' };
const input = { ...selection, prompt: 'Tạo game ninja nhặt xu và tránh quái' };
const signal = () => new AbortController().signal;
const service = () => new GameGenerationService(mockRegistry());

describe('ProviderRegistry', () => {
  it('resolves each request independently and returns copies of metadata', () => {
    const registry = mockRegistry();
    const gemini = registry.resolve(selection.providerId, selection.modelId);
    const groq = registry.resolve('groq', 'llama-3.3-70b-versatile');
    expect(gemini.provider.id).toBe('gemini');
    expect(groq.provider.id).toBe('groq');
    expect(groq.model.capabilities.outputMode).toBe('json_mode');
    gemini.model.id = 'mutated';
    expect(registry.resolve(selection.providerId, selection.modelId).model.id).toBe(selection.modelId);
  });

  it.each([
    ['unknown', selection.modelId, 'invalid_provider'],
    ['gemini', 'paid-model', 'invalid_model'],
    ['gemini', 'llama-3.3-70b-versatile', 'invalid_model'],
  ])('rejects %s / %s', (providerId, modelId, code) => {
    expect(() => mockRegistry().resolve(providerId!, modelId!)).toThrow(expect.objectContaining({ code }));
  });

  it('does not expose keys and never enables models implicitly', () => {
    const registry = createProviderRegistry({ GEMINI_API_KEY: 'secret-test-key' });
    const descriptions = registry.list();
    expect(descriptions.find((item) => item.id === 'gemini')?.reason).toBe('models_unconfigured');
    expect(descriptions.find((item) => item.id === 'groq')?.reason).toBe('missing_key');
    expect(JSON.stringify(descriptions)).not.toContain('secret-test-key');
  });

  it('requires the operator to confirm the account free tier', () => {
    const registry = createProviderRegistry({ GEMINI_API_KEY: 'test-key', GEMINI_ALLOWED_MODELS: selection.modelId });
    expect(registry.list()[0]?.reason).toBe('free_tier_unconfirmed');
    expect(() => registry.resolve(selection.providerId, selection.modelId)).toThrow(expect.objectContaining({ code: 'configuration_required' }));
  });

  it('rejects unsupported IDs even when env explicitly includes them', () => {
    const registry = createProviderRegistry({ GEMINI_API_KEY: 'test-key', GEMINI_ALLOWED_MODELS: `${selection.modelId},imaginary`, GEMINI_FREE_TIER_CONFIRMED: 'true' });
    expect(registry.list()[0]?.reason).toBe('invalid_model');
    expect(() => registry.resolve(selection.providerId, selection.modelId)).toThrow(expect.objectContaining({ code: 'invalid_model' }));
  });

  it('rejects duplicate registrations', () => {
    const registration = { provider: mockProvider(), configured: true, freeTierConfirmed: true, models: MODEL_CATALOG.gemini ?? [] };
    expect(() => new ProviderRegistry([registration, registration])).toThrow('Duplicate');
  });
});

describe('GameSpec validation', () => {
  it.each(['platformer', 'top-down'] as const)('accepts playable %s data', (genre) => {
    expect(GameSpecSchema.parse(sampleSpec(genre)).genre).toBe(genre);
  });
  it.each([
    ['code property', (game: Record<string, unknown>) => { game.code = 'alert(1)'; }],
    ['HTML title', (game: Record<string, unknown>) => { game.title = '<img src=x onerror=alert(1)>'; }],
    ['unknown version', (game: Record<string, unknown>) => { game.version = '2.0'; }],
    ['arbitrary CSS', (game: Record<string, unknown>) => { game.theme = { ...sampleSpec().theme, background: 'url(https://example.com)' }; }],
    ['too many objects', (game: Record<string, unknown>) => { game.collectibles = Array.from({ length: 25 }, () => ({ x: 100, y: 300, value: 1 })); }],
    ['excess speed', (game: Record<string, unknown>) => { game.player = { ...sampleSpec().player, speed: 10000 }; }],
    ['impossible score', (game: Record<string, unknown>) => { game.win = { ...sampleSpec().win, type: 'reach_score', scoreTarget: 100 }; }],
    ['unreachable coin', (game: Record<string, unknown>) => { game.collectibles = [{ x: 900, y: 100, value: 1 }]; }],
    ['enemy overlapping spawn', (game: Record<string, unknown>) => { game.enemies = [{ ...sampleSpec().enemies[0], x: 100, y: 460 }]; }],
    ['out of bounds patrol', (game: Record<string, unknown>) => { game.enemies = [{ ...sampleSpec().enemies[0], x: 940, range: 100 }]; }],
    ['spawn inside obstacle', (game: Record<string, unknown>) => { game.obstacles = [{ x: 100, y: 460, width: 60, height: 40 }]; }],
  ])('rejects %s', (_name, mutate) => {
    const game: Record<string, unknown> = sampleSpec();
    mutate(game);
    expect(GameSpecSchema.safeParse(game).success).toBe(false);
  });
  it('accepts a single fenced JSON response without evaluating it', () => {
    expect(parseGameSpec(`\`\`\`json\n${JSON.stringify(sampleSpec())}\n\`\`\``).title).toBe('Ninja Moon');
  });
  it.each(['{', 'null', 'window.alert(1)', '{"code":"alert(1)"}', 'x'.repeat(32769)])('rejects invalid response %#', (text) => {
    expect(() => parseGameSpec(text)).toThrow(expect.objectContaining({ code: 'invalid_game_spec', status: 422 }));
  });
});

describe('AI HTTP and generation service', () => {
  it('lists configuration without calling provider methods', async () => {
    const provider = mockProvider();
    const generate = vi.spyOn(provider, 'generate');
    const connect = vi.spyOn(provider, 'testConnection');
    const app = createApp({ generationService: new GameGenerationService(mockRegistry([provider])) });
    await request(app).get('/api/ai/providers').expect(200);
    expect(generate).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled();
    await request(app).post('/api/ai/test-connection').send(selection).expect(200);
    expect(connect).toHaveBeenCalledOnce(); expect(generate).not.toHaveBeenCalled();
  });

  it('generates validated games through either provider, preserving per-request selection', async () => {
    const app = createApp({ generationService: service() });
    const [a, b] = await Promise.all([
      request(app).post('/api/games/generate').send(input),
      request(app).post('/api/games/generate').send({ ...input, providerId: 'groq', modelId: 'llama-3.3-70b-versatile', prompt: 'Create a ninja game' }),
    ]);
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    const gameA = GenerateGameResponseSchema.parse(a.body).data;
    const gameB = GenerateGameResponseSchema.parse(b.body).data;
    expect(gameA.provider).toBe('gemini'); expect(gameB.provider).toBe('groq');
    expect(gameA.id).not.toBe(gameB.id); expect(gameA.prompt).toBe(input.prompt);
  });

  it.each([
    [{ ...input, providerId: 'unknown' }, 'invalid_provider', 400],
    [{ ...input, modelId: 'not-allowed' }, 'invalid_model', 400],
    [{ prompt: 'game', providerId: 'gemini' }, 'invalid_model', 400],
  ])('rejects invalid selection %#', async (body, code, status) => {
    const response = await request(createApp({ generationService: service() })).post('/api/games/generate').send(body).expect(status as number);
    expect(response.body.error.code).toBe(code);
  });

  it('keeps missing-key providers unavailable and responds without crashing', async () => {
    const app = createApp({ generationService: new GameGenerationService(createProviderRegistry({})) });
    const response = await request(app).post('/api/games/generate').send(input).expect(503);
    expect(response.body.error.code).toBe('missing_key');
    await request(app).get('/api/health').expect(200);
  });

  it('returns structured validation errors and never silently retries', async () => {
    const provider = mockProvider('gemini', vi.fn(async () => '{"code":"secret output"}'));
    const app = createApp({ generationService: new GameGenerationService(mockRegistry([provider])) });
    const response = await request(app).post('/api/games/generate').send(input).expect(422);
    expect(response.body.error.code).toBe('invalid_game_spec');
    expect(response.body.error.issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(response.body)).not.toContain('secret output');
    expect(provider.generate).toHaveBeenCalledOnce();
  });

  it.each([[429, 'rate_limit', 429], [401, 'provider_error', 502], [500, 'provider_error', 502], [404, 'invalid_model', 400]] as const)(
    'normalizes provider %i without falling back or leaking details', async (upstream, code, status) => {
      const provider = mockProvider('gemini', vi.fn(async () => { throw { status: upstream, message: 'API key=private-value' }; }));
      const fallback = mockProvider('groq', vi.fn(async () => JSON.stringify(sampleSpec())));
      const app = createApp({ generationService: new GameGenerationService(mockRegistry([provider, fallback])) });
      const response = await request(app).post('/api/games/generate').send(input).expect(status);
      expect(response.body.error.code).toBe(code); expect(JSON.stringify(response.body)).not.toContain('private-value');
      expect(provider.generate).toHaveBeenCalledOnce(); expect(fallback.generate).not.toHaveBeenCalled();
      if (status === 429) expect(response.headers['retry-after']).toBe('60');
    },
  );

  it('aborts timed out generation and releases the concurrency slot', async () => {
    let aborted = false;
    const provider = mockProvider('gemini', (request) => new Promise((_resolve, reject) => {
      request.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
    }));
    const budget = new RequestBudget({ maxConcurrent: 1 });
    const generator = new GameGenerationService(mockRegistry([provider]), budget, 20);
    await expect(generator.generate(input, 'a', signal())).rejects.toMatchObject({ code: 'timeout' });
    expect(aborted).toBe(true);
    const release = budget.acquire('b'); release();
  });

  it('cancels a disconnected client request', async () => {
    const controller = new AbortController();
    const provider = mockProvider('gemini', async () => new Promise(() => {}));
    const pending = new GameGenerationService(mockRegistry([provider])).generate(input, 'a', controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('returns Retry-After for the shared connection/generation budget', async () => {
    const app = createApp({ generationService: new GameGenerationService(mockRegistry(), new RequestBudget({ requestsPerMinute: 1 })) });
    await request(app).post('/api/ai/test-connection').send(selection).expect(200);
    const response = await request(app).post('/api/games/generate').send(input).expect(429);
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
