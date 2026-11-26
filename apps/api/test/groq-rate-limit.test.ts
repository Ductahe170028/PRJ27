import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroqRateLimiter, durationMs, retryAfterMs, estimateInputTokens, groqErrorDetail, responseFormatDiagnostic, safeSchemaPath } from '../src/providers/groq-rate-limit.js';
import { RequestCapacityError, TransientRateLimitError } from '../src/providers/errors.js';
import { AiGateway } from '../src/services/ai-gateway.js';
import { MODEL_CATALOG } from '../src/providers/model-catalog.js';
import { mockProvider, mockRegistry } from './fixtures.js';
import { RequestBudget } from '../src/services/request-budget.js';
import type { AIRequest } from '../src/providers/ai-provider.js';

const makeRequest = (overrides: Partial<AIRequest> = {}): AIRequest => ({ model: MODEL_CATALOG.groq![0]!, prompt: 'game', systemPrompt: 'code', jsonSchema: {}, maxOutputTokens: 100,
  signal: new AbortController().signal, ...overrides });
const throttle = (message: string, headers: Record<string, string> = {}, status = 429) => ({ status, error: { error: { message } }, headers: new Headers(headers) });

describe('Groq free-plan pacing', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
  afterEach(() => { vi.useRealTimers(); });

  it('parses compound reset durations and retry-after seconds/dates without accepting malformed headers', () => {
    expect(durationMs('2m59.56s')).toBe(179560);
    expect(durationMs('20ms')).toBe(20);
    expect(retryAfterMs('1.25')).toBe(1250);
    expect(retryAfterMs(new Date(Date.now() + 3000).toUTCString())).toBe(3000);
    for (const value of ['', '-1s', 'NaN', '3days', '100000h', '4s garbage']) expect(durationMs(value)).toBeUndefined();
    expect(retryAfterMs('-4')).toBeUndefined();
  });

  it('spaces requests and waits for token reset before reserving the next output budget', async () => {
    const limiter = new GroqRateLimiter();
    const request = makeRequest({ onTelemetry: vi.fn() });
    (await limiter.acquire(request))();
    const second = limiter.acquire(request);
    await vi.advanceTimersByTimeAsync(2100);
    (await second)();
    expect(request.onTelemetry).toHaveBeenCalledWith({ type: 'wait', milliseconds: 2100, reason: 'spacing' });
    limiter.observe(request.model.id, new Headers({ 'x-ratelimit-limit-tokens': '8000', 'x-ratelimit-remaining-tokens': '10', 'x-ratelimit-reset-tokens': '50s' }));
    let dispatched = false;
    const third = limiter.acquire(request).then((release) => { dispatched = true; return release; });
    await vi.advanceTimersByTimeAsync(50_249);
    expect(dispatched).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    (await third)();
    expect(request.onTelemetry).toHaveBeenLastCalledWith({ type: 'wait', milliseconds: 50_250, reason: 'tokens' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a single oversized request immediately and uses the actual header limit', async () => {
    const limiter = new GroqRateLimiter();
    const request = makeRequest({ maxOutputTokens: 1500 });
    limiter.observe(request.model.id, new Headers({ 'x-ratelimit-limit-tokens': '1000' }));
    await expect(limiter.acquire(request)).rejects.toBeInstanceOf(RequestCapacityError);
    expect(vi.getTimerCount()).toBe(0);
    expect(limiter.error(request.model.id, throttle('tokens per minute (TPM): Limit 1000, Requested 1200', {}, 413))).toMatchObject({ tokenLimit: 1000 });
    expect(estimateInputTokens(makeRequest({ prompt: 'á'.repeat(100) }))).toBeGreaterThan(estimateInputTokens(makeRequest({ prompt: 'a'.repeat(100) })));
  });

  it('treats request headers as daily quota, never as RPM', async () => {
    const limiter = new GroqRateLimiter(), request = makeRequest();
    limiter.observe(request.model.id, new Headers({ 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '1h' }));
    await expect(limiter.acquire(request)).rejects.toMatchObject({ code: 'rate_limit', retryAfterSeconds: 3600 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('only retries a known short throttle, not daily/auth/unknown quota or an hour-long wait', () => {
    const limiter = new GroqRateLimiter(), model = makeRequest().model.id;
    const error = limiter.error(model, throttle('tokens per minute (TPM): Limit 8000, Used 7000, Requested 2000', { 'retry-after': '3' }));
    expect(error).toBeInstanceOf(TransientRateLimitError);
    expect(error.retryAfterSeconds).toBe(4);
    for (const cause of [throttle('tokens per day TPD', { 'retry-after': '3' }), throttle('quota'), throttle('TPM', { 'retry-after': '3600' }), throttle('bad key', {}, 401)]) {
      expect(limiter.error(model, cause)).not.toBeInstanceOf(TransientRateLimitError);
    }
    const invalidJson = limiter.error(model, { status: 400, error: { error: { code: 'json_validate_failed', failed_generation: 'SECRET-CODE' } } });
    expect(invalidJson).toMatchObject({ code: 'invalid_code', failedGeneration: 'SECRET-CODE', providerStatus: 400 });
    expect(invalidJson.message).toContain('JSON do model sinh');
    expect(invalidJson.message).toContain('json_validate_failed');
    expect(invalidJson.message).toContain('không phải lỗi TypeScript');
    expect(invalidJson.message).not.toContain('SECRET-CODE');
    expect(invalidJson.message).not.toContain('từ chối JSON Schema');
    const rejectedSchema = limiter.error(model, { status: 400, error: { message: 'ignored upstream text', code: 'json_validate_failed', schema_path: '/properties/title/minLength' } });
    expect(rejectedSchema).toMatchObject({ failedGeneration: undefined, schemaPath: '/properties/title/minLength', providerStatus: 400 });
    expect(rejectedSchema.message).toContain('từ chối JSON Schema');
    expect(rejectedSchema.message).toContain('/properties/title/minLength');
    expect(rejectedSchema.message).toContain('Không có failed_generation');
    expect(rejectedSchema.message).not.toContain('ignored upstream text');
    expect(rejectedSchema.message).not.toContain('không khớp');
    expect(groqErrorDetail({ error: { error: { code: 'json_validate_failed', failed_generation: 'body' } } }).code).toBe('json_validate_failed');
    expect(safeSchemaPath('Bearer gsk_secret')).toBeUndefined();
    expect(responseFormatDiagnostic({ type: 'json_schema', json_schema: { name: 'shooter_brief_v1', strict: true, schema: { properties: { title: { minLength: 1, maxLength: 80 }, mechanics: { minItems: 2, maxItems: 8 } } } } }).unsupportedKeywords).toEqual([
      'schema.properties.title.minLength', 'schema.properties.title.maxLength', 'schema.properties.mechanics.minItems', 'schema.properties.mechanics.maxItems',
    ]);
    expect(limiter.error(model, { status: 429, headers: new Headers({ 'retry-after': '2' }), error: { error: { code: 'insufficient_quota', message: 'Quota exceeded' } } })).not.toBeInstanceOf(TransientRateLimitError);
  });

  it('cancels token waits, clears timers and does not let a cancelled waiter bypass the running request', async () => {
    const limiter = new GroqRateLimiter(), request = makeRequest(), controller = new AbortController();
    const release = await limiter.acquire(request);
    const cancelled = limiter.acquire({ ...request, signal: controller.signal });
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejected;
    const ready = vi.fn();
    const next = limiter.acquire(request).then((unlock) => { ready(); return unlock; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ready).not.toHaveBeenCalled();
    release(); (await next)();
    limiter.observe(request.model.id, new Headers({ 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '60s' }));
    const waiting = new AbortController();
    const pending = limiter.acquire({ ...request, signal: waiting.signal });
    const stopped = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1); waiting.abort(); await stopped;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits outside the HTTP timeout and retries a network throttle at most once', async () => {
    const limiter = new GroqRateLimiter();
    const generate = vi.fn(async (request: AIRequest) => {
      if (generate.mock.calls.length === 1) throw limiter.error(request.model.id, throttle('TPM', { 'retry-after': '50' }));
      return 'ok';
    });
    const provider = { ...mockProvider('groq', generate), prepare: (request: AIRequest) => limiter.acquire(request) };
    const service = new AiGateway(mockRegistry([provider]), undefined, 1000);
    const result = service.generateArtifact({ providerId: 'groq' }, makeRequest(), 'client', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(50_249);
    expect(generate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('ok');
    expect(generate).toHaveBeenCalledTimes(2);
    generate.mockImplementation(async () => { throw new TransientRateLimitError(1); });
    const failure = expect(service.generateArtifact({ providerId: 'groq' }, makeRequest(), 'client', new AbortController().signal)).rejects.toBeInstanceOf(TransientRateLimitError);
    await vi.advanceTimersByTimeAsync(5000); await failure;
    expect(generate).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('paces split requests through the local minute budget without bypassing its daily cap', async () => {
    const limiter = new GroqRateLimiter(), onTelemetry = vi.fn();
    const generate = vi.fn(async () => 'code');
    const provider = { ...mockProvider('groq', generate), prepare: (request: AIRequest) => limiter.acquire(request) };
    const service = new AiGateway(mockRegistry([provider]), new RequestBudget({ requestsPerMinute: 1, requestsPerDay: 2 }), 1000);
    await service.generateArtifact({ providerId: 'groq' }, makeRequest(), 'client', new AbortController().signal);
    const second = service.generateArtifact({ providerId: 'groq' }, makeRequest({ onTelemetry }), 'client', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(onTelemetry).toHaveBeenCalledWith({ type: 'wait', milliseconds: 60_000, reason: 'budget' });
    await vi.advanceTimersByTimeAsync(1); await second;
    const third = expect(service.generateArtifact({ providerId: 'groq' }, makeRequest(), 'client', new AbortController().signal)).rejects.toMatchObject({ code: 'rate_limit' });
    await vi.advanceTimersByTimeAsync(2100); await third;
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('aborts a service quota wait without dispatching a retry', async () => {
    const limiter = new GroqRateLimiter(), controller = new AbortController();
    const generate = vi.fn(async (request: AIRequest) => { throw limiter.error(request.model.id, throttle('TPM', { 'retry-after': '30' })); });
    const provider = { ...mockProvider('groq', generate), prepare: (request: AIRequest) => limiter.acquire(request) };
    const service = new AiGateway(mockRegistry([provider]));
    const pending = expect(service.generateArtifact({ providerId: 'groq' }, makeRequest(), 'client', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort(); await pending;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(generate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
