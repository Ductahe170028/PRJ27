import type { AIRequest } from './ai-provider.js';
import { AIError, RequestCapacityError, StructuredOutputError, TransientRateLimitError, normalizeProviderError } from './errors.js';

// Free-plan fallback for the supported GPT-OSS models. Live headers override it.
// These are estimates for admission, never presented as measured token usage.
export function estimateInputTokens(request: Pick<AIRequest, 'prompt' | 'systemPrompt' | 'jsonSchema'>): number {
  return Math.ceil(Buffer.byteLength(request.prompt + request.systemPrompt + JSON.stringify(request.jsonSchema), 'utf8') / 3) + 128;
}

export const UNSUPPORTED_SCHEMA_KEYWORDS = new Set(['$schema', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern']);
const SCHEMA_PATH = /^(?:#|\/)?[A-Za-z0-9_./[\]-]{1,180}$/;

export function safeSchemaPath(value: unknown): string | undefined {
  return typeof value === 'string' && SCHEMA_PATH.test(value) ? value : undefined;
}

/** Unwrap a Groq HTTP body or SDK error down to the innermost error object. */
export function groqErrorDetail(value: unknown): Record<string, unknown> {
  let current: unknown = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return {};
    const record = current as Record<string, unknown>;
    if (typeof record.error !== 'object' || record.error === null) return record;
    current = record.error;
  }
  return typeof current === 'object' && current !== null ? current as Record<string, unknown> : {};
}

export function unsupportedSchemaPaths(schema: unknown, path = 'schema'): string[] {
  if (Array.isArray(schema)) return schema.flatMap((item, index) => unsupportedSchemaPaths(item, `${path}[${index}]`));
  if (!schema || typeof schema !== 'object') return [];
  const found: string[] = [];
  for (const [key, child] of Object.entries(schema)) {
    if (UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) found.push(`${path}.${key}`);
    else found.push(...unsupportedSchemaPaths(child, `${path}.${key}`));
  }
  return found.slice(0, 24);
}

export function responseFormatDiagnostic(responseFormat: unknown): { type?: string; name?: string; strict?: boolean; schema?: unknown; unsupportedKeywords: string[] } {
  const format = typeof responseFormat === 'object' && responseFormat !== null ? responseFormat as Record<string, unknown> : {};
  const wrapped = typeof format.json_schema === 'object' && format.json_schema !== null ? format.json_schema as Record<string, unknown> : {};
  const schema = wrapped.schema ?? format.schema;
  return {
    ...(typeof format.type === 'string' ? { type: format.type } : {}),
    ...(typeof wrapped.name === 'string' && wrapped.name.length <= 64 ? { name: wrapped.name } : {}),
    ...(typeof wrapped.strict === 'boolean' ? { strict: wrapped.strict } : {}),
    ...(schema && typeof schema === 'object' ? { schema } : {}),
    unsupportedKeywords: unsupportedSchemaPaths(schema),
  };
}

function structuredOutputError(detail: Record<string, unknown>, httpStatus?: number): StructuredOutputError {
  const failed = typeof detail.failed_generation === 'string' && detail.failed_generation.length <= 65_536 ? detail.failed_generation : undefined;
  const schemaPath = safeSchemaPath(detail.schema_path);
  if (failed) {
    return new StructuredOutputError('Groq trả JSON do model sinh không khớp schema (json_validate_failed). Đây không phải provider từ chối schema, không phải lỗi TypeScript, rate limit hay hết quota.', failed, schemaPath, httpStatus);
  }
  const where = schemaPath ? ` Thuộc tính schema: ${schemaPath}.` : '';
  return new StructuredOutputError(`Groq từ chối JSON Schema trước khi trả nội dung (json_validate_failed).${where} Không có failed_generation. Đây không phải JSON do model sinh ra, không phải lỗi TypeScript, rate limit hay hết quota.`, undefined, schemaPath, httpStatus);
}

export function durationMs(value: string | null): number | undefined {
  if (!value || !/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(value)) return undefined;
  let total = 0;
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
    total += Number(match[1]) * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2]!] ?? 0);
  }
  return Number.isFinite(total) && total <= 86_400_000 ? total : undefined;
}

export function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  if (value.startsWith('-') || value.startsWith('+')) return undefined;
  const milliseconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : undefined;
}

export async function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => { abort = () => reject(signal.reason); });
  signal.addEventListener('abort', abort, { once: true });
  try { return await Promise.race([pending, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

export async function waitForRateLimit(milliseconds: number, signal: AbortSignal): Promise<void> {
  let timer!: ReturnType<typeof setTimeout>;
  try { await abortable(new Promise<void>((resolve) => { timer = setTimeout(resolve, milliseconds); }), signal); }
  finally { clearTimeout(timer); }
}

interface State {
  limit: number; remaining?: number; resetAt: number; requests?: number; requestsResetAt: number; retryAt: number; nextAt: number;
}
const numberHeader = (headers: Headers, name: string): number | undefined => {
  const raw = headers.get(name);
  const number = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};

export class GroqRateLimiter {
  private readonly models = new Map<string, State>();
  private tail = Promise.resolve();
  private state(model: string): State {
    let state = this.models.get(model);
    if (!state) { state = { limit: 8000, resetAt: 0, requestsResetAt: 0, retryAt: 0, nextAt: 0 }; this.models.set(model, state); }
    return state;
  }

  observe(model: string, headers: Headers, usedTokens?: number): State {
    const state = this.state(model), now = Date.now();
    const limit = numberHeader(headers, 'x-ratelimit-limit-tokens');
    if (limit && limit > 0) state.limit = limit;
    const remaining = numberHeader(headers, 'x-ratelimit-remaining-tokens');
    if (remaining !== undefined) state.remaining = remaining;
    else if (usedTokens !== undefined) state.remaining = Math.max(0, (state.resetAt <= now ? state.limit : state.remaining ?? state.limit) - usedTokens);
    state.resetAt = now + (durationMs(headers.get('x-ratelimit-reset-tokens')) ?? 60_000);
    const requests = numberHeader(headers, 'x-ratelimit-remaining-requests');
    if (requests !== undefined) state.requests = requests;
    state.requestsResetAt = now + (durationMs(headers.get('x-ratelimit-reset-requests')) ?? 86_400_000);
    return state;
  }

  async acquire(request: AIRequest): Promise<() => void> {
    const previous = this.tail;
    let unlock!: () => void;
    const slot = new Promise<void>((resolve) => { unlock = resolve; });
    // A cancelled waiter must not let later work overtake its predecessor.
    this.tail = previous.then(() => slot);
    try {
      await abortable(previous, request.signal);
      const state = this.state(request.model.id);
      const input = estimateInputTokens(request), output = request.maxOutputTokens ?? 4096;
      if (input + output > state.limit) throw new RequestCapacityError(state.limit, input, output);
      const now = Date.now();
      // Request headers describe RPD, NOT RPM. Daily exhaustion is never retried.
      if (state.requests === 0 && now < state.requestsResetAt) throw new AIError('rate_limit', 'Groq đã hết số request trong ngày; không tự gửi lại.', 429, Math.max(1, Math.ceil((state.requestsResetAt - now) / 1000)));
      const tokensAt = state.remaining !== undefined && state.remaining < input + output && now < state.resetAt ? state.resetAt + 250 : 0;
      const until = Math.max(tokensAt, state.retryAt, state.nextAt);
      if (until > now) {
        request.onTelemetry?.({ type: 'wait', milliseconds: until - now, reason: until === state.retryAt ? 'retry' : until === tokensAt ? 'tokens' : 'spacing' });
        await waitForRateLimit(until - now, request.signal);
      }
      request.signal.throwIfAborted();
      state.nextAt = Date.now() + 2100; // 30 RPM free plan, with a small margin.
      return unlock;
    } catch (error) { unlock(); throw error; }
  }

  error(model: string, cause: unknown): AIError {
    if (cause instanceof AIError) return cause;
    const record = typeof cause === 'object' && cause !== null ? cause as Record<string, unknown> : {};
    const headers = record.headers instanceof Headers ? record.headers : new Headers();
    const state = this.observe(model, headers);
    const status = Number(record.status);
    const detail = groqErrorDetail(record);
    const message = typeof detail.message === 'string' ? detail.message : typeof record.message === 'string' ? record.message : '';
    if (status === 400 && detail.code === 'json_validate_failed') return structuredOutputError(detail, 400);
    const limit = /Limit[: ]+(\d+)/i.exec(message)?.[1];
    const requested = /Requested[: ]+(\d+)/i.exec(message)?.[1];
    const tokenMinute = /tokens per minute|\bTPM\b/i.test(message);
    if ((status === 429 || status === 413) && tokenMinute && limit && requested && Number(requested) > Number(limit)) {
      state.limit = Number(limit);
      return new RequestCapacityError(state.limit, Number(requested), 0);
    }
    const errorCode = typeof detail.code === 'string' ? detail.code : '';
    const daily = /per day|\b[RT]PD\b|billing|credit|insufficient_quota/i.test(`${message} ${errorCode}`) || state.requests === 0;
    const retry = retryAfterMs(headers.get('retry-after'));
    // Only retry a known short-lived throttle, never a generic/daily quota error.
    if (status === 429 && !daily && (tokenMinute || /requests per minute|\bRPM\b/i.test(message) || retry !== undefined)) {
      const wait = Math.max(1000, retry ?? 60_000) + 250;
      if (wait <= 60_250) { state.retryAt = Date.now() + wait; return new TransientRateLimitError(wait); }
    }
    return normalizeProviderError(cause);
  }
}
