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
import { GAME_SYSTEM_PROMPT, describeSchema } from '../src/services/system-prompt.js';
import { normalizeProviderError } from '../src/providers/errors.js';
import { mockProvider, mockRegistry, sampleSpec } from './fixtures.js';

const selection = { providerId: 'gemini', modelId: 'gemini-3.5-flash-lite' };
const input = { ...selection, prompt: 'Tạo game ninja nhặt xu và tránh quái' };
const signal = () => new AbortController().signal;
const service = () => new GameGenerationService(mockRegistry());

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

describe('System prompt', () => {
  it('describes every GameSpec bound compactly instead of dumping the JSON Schema', () => {
    const lines = describeSchema();
    expect(lines).toContain('player: x=int 16..944, y=int 80..484, size=int 24..40, speed=int 80..320, jumpSpeed=int 350..600, health=int 1..5');
    expect(lines.some((line) => line.startsWith('collectibles[] (1-24 items): '))).toBe(true);
    expect(lines.some((line) => line.startsWith('difficulty: ') && line.includes('enemySpeedMultiplier=number 0.5..2'))).toBe(true);
    expect(GAME_SYSTEM_PROMPT).not.toContain('"additionalProperties"');
    // Groq free tier allows 8K tokens/minute including the output budget.
    expect(GAME_SYSTEM_PROMPT.length).toBeLessThan(4_500);
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

describe('GameSpec validation', () => {
  it('normalizes inactive numeric fields and excessive patrol radius before strict validation', () => {
    const game = sampleSpec('top-down');
    game.player.jumpSpeed = 0;
    game.difficulty.gravity = 0;
    game.win.surviveSeconds = 0;
    game.win.scoreTarget = 0;
    game.enemies[0]!.range = 200;
    game.obstacles[0]!.width = 10;
    game.obstacles[0]!.height = 5;
    const normalized = parseGameSpec(JSON.stringify(game));
    expect(normalized.player.jumpSpeed).toBe(350);
    expect(normalized.difficulty.gravity).toBe(800);
    expect(normalized.win.surviveSeconds).toBe(10);
    expect(normalized.win.scoreTarget).toBe(1);
    expect(normalized.enemies[0]?.range).toBe(160);
    expect(normalized.obstacles[0]).toMatchObject({ width: 20, height: 16 });
    expect(GameSpecSchema.safeParse(normalized).success).toBe(true);
  });
  it('does not normalize active gameplay constraints or executable/unknown fields', () => {
    const game = sampleSpec();
    game.player.jumpSpeed = 0;
    expect(() => parseGameSpec(JSON.stringify(game))).toThrow(expect.objectContaining({ code: 'invalid_game_spec' }));
    const topDown = { ...sampleSpec('top-down'), code: 'alert(1)' };
    topDown.player.jumpSpeed = 0;
    expect(() => parseGameSpec(JSON.stringify(topDown))).toThrow(expect.objectContaining({ code: 'invalid_game_spec' }));
    expect(() => parseGameSpec(JSON.stringify({ ...sampleSpec('top-down'), win: { type: 'survive', scoreTarget: 0, surviveSeconds: 0 } }))).toThrow(expect.objectContaining({ code: 'invalid_game_spec' }));
    expect(() => parseGameSpec(JSON.stringify({ ...sampleSpec('top-down'), player: { ...sampleSpec('top-down').player, jumpSpeed: '0' } }))).toThrow(expect.objectContaining({ code: 'invalid_game_spec' }));
  });
  it('relocates invalid items without dropping coins or enemies', () => {
    const game = sampleSpec();
    game.collectibles.push({ x: 500, y: 470, value: 10 });
    game.enemies.push({ ...game.enemies[0]!, x: 120, y: 460 });
    const parsed = parseGameSpec(JSON.stringify(game));
    expect(parsed.collectibles).toHaveLength(2);
    expect(parsed.enemies).toHaveLength(2);
    expect(parsed.collectibles[1]).not.toEqual(game.collectibles[1]);
    expect(parsed.enemies[1]).not.toEqual(game.enemies[1]);
    expect(parsed.win).toEqual(game.win);
    expect(parsed.platforms).toEqual(sampleSpec().platforms);
  });
  it('rejects irreparable items instead of reducing counts or score targets', () => {
    const spawnBlocked = sampleSpec();
    spawnBlocked.collectibles.push({ x: 900, y: 100, value: 10 });
    spawnBlocked.obstacles.push({ x: 100, y: 460, width: 60, height: 40 });
    const noEnemiesLeft = sampleSpec();
    noEnemiesLeft.enemies = [{ ...noEnemiesLeft.enemies[0]!, x: 900, y: 100 }];
    const scoreUnreachable = sampleSpec();
    scoreUnreachable.win = { ...scoreUnreachable.win, type: 'reach_score', scoreTarget: 20 };
    scoreUnreachable.collectibles.push({ x: 900, y: 100, value: 10 });
    for (const game of [spawnBlocked, noEnemiesLeft, scoreUnreachable]) {
      expect(() => parseGameSpec(JSON.stringify(game))).toThrow(expect.objectContaining({ code: 'invalid_game_spec', status: 422 }));
    }
  });
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
  it.each([['gemini', 'gemini-3.5-flash-lite'], ['groq', 'openai/gpt-oss-20b']])(
    'uses the %s server default when the request has no model field', async (providerId, modelId) => {
      const app = createApp({ generationService: service() });
      const connection = await request(app).post('/api/ai/test-connection').send({ providerId }).expect(200);
      expect(connection.body.modelId).toBe(modelId);
      const game = await request(app).post('/api/games/generate').send({ prompt: 'Create a ninja game', providerId }).expect(201);
      expect(game.body.data).toMatchObject({ provider: providerId, modelId });
    },
  );
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
      request(app).post('/api/games/generate').send({ ...input, providerId: 'groq', modelId: 'openai/gpt-oss-120b', prompt: 'Create a ninja game' }),
    ]);
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    const gameA = GenerateGameResponseSchema.parse(a.body).data;
    const gameB = GenerateGameResponseSchema.parse(b.body).data;
    expect(gameA.provider).toBe('gemini'); expect(gameB.provider).toBe('groq');
    expect('modelId' in gameA && gameA.modelId).toBe(selection.modelId);
    expect('modelId' in gameB && gameB.modelId).toBe('openai/gpt-oss-120b');
    expect(gameA.id).not.toBe(gameB.id); expect(gameA.prompt).toBe(input.prompt);
  });

  it('passes the system prompt, provider schema and user prompt to the adapter', async () => {
    const provider = mockProvider();
    const generate = vi.spyOn(provider, 'generate');
    await new GameGenerationService(mockRegistry([provider])).generate(input, 'a', signal());
    const call = generate.mock.calls[0]?.[0];
    expect(call).toMatchObject({ prompt: input.prompt, systemPrompt: GAME_SYSTEM_PROMPT, model: { id: selection.modelId } });
    expect(call?.jsonSchema).toMatchObject({ type: 'object', additionalProperties: false });
  });

  it.each([
    [{ ...input, providerId: 'unknown' }, 'invalid_provider', 400],
    [{ ...input, modelId: 'not-allowed' }, 'invalid_model', 400],
    [{ ...input, providerId: 'groq', modelId: 'llama-3.3-70b-versatile' }, 'invalid_model', 400],
    [{ prompt: 'game', modelId: selection.modelId }, 'invalid_model', 400],
    [{ prompt: 'game', providerId: 'demo', modelId: 'other' }, 'invalid_model', 400],
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
