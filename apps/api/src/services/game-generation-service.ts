import { randomUUID } from 'node:crypto';
import {
  AIGameProjectSchema, GAME_SPEC_MAX_BYTES, GameSpecPlacementInputSchema,
  type GameSpec, type GenerateGameRequest, type ProviderRequestSelection,
} from '@game-creator/contracts';
import { ProviderRegistry } from '../providers/provider-registry.js';
import { AIError, type SpecIssue, TransientRateLimitError, normalizeProviderError } from '../providers/errors.js';
import { RequestBudget } from './request-budget.js';
import { GAME_SYSTEM_PROMPT, providerJsonSchema } from './system-prompt.js';
import { normalizeGeneratedSpec } from './normalize-game-spec.js';
import { repairGamePlacement } from './repair-game-placement.js';
import { GENERIC_SPEC_MESSAGE, withReason } from './failure-reason.js';
import { repairInWorker, type RepairRunner } from './isolated-repair.js';
import type { AIRequest } from '../providers/ai-provider.js';
import { waitForRateLimit } from '../providers/groq-rate-limit.js';
import { redactDiagnostics } from './redact.js';
import { diagnosticSink } from '../providers/diagnostic-sink.js';
import {
  openStandardDiagnostics, type StandardDiagnostics, type StandardFinish, type StandardRequest, type StandardValidation,
} from './standard-diagnostics.js';

interface SpecCapture {
  stage: 'provider' | 'parse' | 'normalize' | 'schema' | 'repair' | 'ok';
  parsed?: unknown;
  normalized?: unknown;
  validationSuccess: boolean;
  issues: SpecIssue[];
}

function toSpecIssues(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; code: string; message: string }>): SpecIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map((part) => (typeof part === 'symbol' ? part.description ?? 'symbol' : String(part))).join('.'),
    code: issue.code,
    message: redactDiagnostics(issue.message),
  }));
}

/** JSON parse, normalize and the placement-input schema. Leaves the capture at
 * stage 'repair'; the caller runs repair (in a worker for HTTP requests). */
export function parseGameSpecInput(text: string, capture?: SpecCapture): GameSpec {
  if (Buffer.byteLength(text, 'utf8') > GAME_SPEC_MAX_BYTES) {
    if (capture) capture.stage = 'parse';
    throw new AIError('invalid_game_spec', 'GameSpec vượt quá giới hạn 32 KB.', 422);
  }
  // A single fenced JSON block can be unwrapped safely; nothing is evaluated.
  const clean = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
  let data: unknown;
  try { data = JSON.parse(clean); } catch {
    if (capture) capture.stage = 'parse';
    throw new AIError('invalid_game_spec', 'Provider không trả về JSON hợp lệ. Hãy thử mô tả đơn giản hơn.', 422);
  }
  if (capture) {
    capture.parsed = structuredClone(data);
    capture.stage = 'normalize';
  }
  const normalized = normalizeGeneratedSpec(data);
  if (capture) {
    capture.normalized = structuredClone(normalized);
    capture.stage = 'schema';
  }
  const parsed = GameSpecPlacementInputSchema.safeParse(normalized);
  if (!parsed.success) {
    const details = toSpecIssues(parsed.error.issues);
    if (capture) {
      capture.validationSuccess = false;
      capture.issues = details;
      capture.stage = 'schema';
    }
    throw new AIError(
      'invalid_game_spec',
      withReason(GENERIC_SPEC_MESSAGE, details[0]?.path),
      422, undefined, details.map((issue) => issue.path), details,
    );
  }
  if (capture) {
    capture.validationSuccess = true;
    capture.issues = [];
    capture.stage = 'repair';
  }
  return parsed.data;
}

/** Synchronous parse + repair, same result as the HTTP path without a worker. */
export function parseGameSpec(text: string, capture?: SpecCapture): GameSpec {
  const input = parseGameSpecInput(text, capture);
  const game = repairGamePlacement(input);
  if (capture) capture.stage = 'ok';
  return game;
}

function issuesFromError(error: unknown, capture: SpecCapture): SpecIssue[] {
  if (capture.issues.length > 0) return capture.issues;
  if (!(error instanceof AIError)) return [];
  if (error.details?.length) return error.details;
  return (error.issues ?? []).map((issuePath) => ({ path: issuePath, code: error.code, message: error.message }));
}

function validationRecord(capture: SpecCapture): StandardValidation {
  if (capture.stage === 'provider' || capture.stage === 'parse' || capture.stage === 'normalize') return { status: 'not_reached' };
  return { status: 'checked', schema: 'GameSpecPlacementInputSchema', success: capture.validationSuccess, issues: capture.issues };
}

function standardFinish(input: {
  capture: SpecCapture;
  outcome: 'completed' | 'failed';
  stage: StandardFinish['stage'];
  raw?: string;
  error?: unknown;
}): StandardFinish {
  const issues = input.outcome === 'completed' ? [] : issuesFromError(input.error, input.capture);
  const record: StandardFinish = {
    stage: input.stage,
    outcome: input.outcome,
    parsed: input.capture.parsed ?? null,
    normalized: input.capture.normalized ?? null,
    validation: validationRecord(input.capture),
    issues,
  };
  if (input.raw !== undefined) record.raw = input.raw;
  if (input.error instanceof AIError) {
    record.errorCode = input.error.code;
    record.errorMessage = input.error.message;
  } else if (input.error instanceof Error) record.errorMessage = input.error.message;
  else if (input.outcome === 'failed') record.errorMessage = 'Không thể tạo game.';
  return record;
}

export class GameGenerationService {
  constructor(
    readonly registry: ProviderRegistry,
    private readonly budget = new RequestBudget(),
    private readonly timeoutMs = 45_000,
    private readonly openDiagnostics: (input: StandardRequest) => Promise<StandardDiagnostics> = openStandardDiagnostics,
    private readonly repair: RepairRunner = repairInWorker,
  ) {}

  private async note(task: () => Promise<void>): Promise<void> {
    try { await task(); } catch { /* Diagnostics must not change the generation result. */ }
  }

  private async beginDiagnostics(input: StandardRequest): Promise<StandardDiagnostics> {
    try { return await this.openDiagnostics(input); }
    catch { return { async note() {}, async raw() {}, async finish() {} }; }
  }

  private async execute<T>(client: string, signal: AbortSignal, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (signal.aborted) throw new AIError('cancelled', 'Yêu cầu đã bị hủy.', 499);
    const release = this.budget.acquire(client);
    const controller = new AbortController();
    let rejectAbort: (error: AIError) => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const abort = (error: AIError) => { controller.abort(error); rejectAbort(error); };
    const onDisconnect = () => abort(new AIError('cancelled', 'Yêu cầu đã bị hủy.', 499));
    signal.addEventListener('abort', onDisconnect, { once: true });
    const timer = setTimeout(() => abort(new AIError('timeout', 'Provider phản hồi quá lâu. Yêu cầu đã dừng; hãy thử lại sau.', 504)), this.timeoutMs);
    try { return await Promise.race([task(controller.signal), aborted]); }
    catch (error) { throw controller.signal.aborted ? controller.signal.reason : normalizeProviderError(error); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', onDisconnect); release(); }
  }

  async generate(request: GenerateGameRequest & ProviderRequestSelection, client: string, signal: AbortSignal) {
    const { provider, model } = this.registry.resolve(request.providerId, request.modelId);
    const diag = await this.beginDiagnostics({ prompt: request.prompt, provider: provider.id, model: model.id });
    const capture: SpecCapture = { stage: 'provider', validationSuccess: false, issues: [] };
    let sawOutput = false;
    try {
      const text = await diagnosticSink.run(diag, () => this.execute(client, signal, (abortSignal) => provider.generate({
        prompt: request.prompt, model, signal: abortSignal,
        systemPrompt: GAME_SYSTEM_PROMPT, jsonSchema: providerJsonSchema(),
      })));
      sawOutput = true;
      await this.note(() => diag.raw(text));
      try {
        const input = parseGameSpecInput(text, capture);
        // Repair runs off the event loop, with a hard timeout; a client
        // disconnect terminates it.
        const game = await this.repair(input, signal);
        capture.stage = 'ok';
        const project = AIGameProjectSchema.parse({
          id: randomUUID(), title: game.title, prompt: request.prompt,
          provider: provider.id, modelId: model.id, capabilities: model.capabilities,
          createdAt: new Date().toISOString(), game,
        });
        await this.note(() => diag.finish(standardFinish({ capture, outcome: 'completed', stage: 'response', raw: text })));
        return project;
      } catch (error) {
        const stage = capture.stage === 'ok' ? 'response' : capture.stage;
        await this.note(() => diag.finish(standardFinish({ capture, outcome: 'failed', stage, raw: text, error })));
        throw error;
      }
    } catch (error) {
      if (!sawOutput) await this.note(() => diag.finish(standardFinish({ capture, outcome: 'failed', stage: 'provider', error })));
      throw error;
    }
  }

  async testConnection(selection: ProviderRequestSelection, client: string, signal: AbortSignal) {
    const { provider, model } = this.registry.resolve(selection.providerId, selection.modelId);
    await this.execute(client, signal, (abortSignal) => provider.testConnection(model, abortSignal));
    return {
      status: 'connected' as const, providerId: provider.id, modelId: model.id,
      message: 'Đã kết nối provider và tìm thấy model của ứng dụng. Kiểm tra này không sinh nội dung và không xác nhận quota còn lại.',
    };
  }

  async generateArtifact(selection: ProviderRequestSelection, input: Pick<AIRequest, 'prompt' | 'systemPrompt' | 'jsonSchema' | 'maxOutputTokens' | 'onTelemetry'>, client: string, signal: AbortSignal): Promise<string> {
    const { provider, model } = this.registry.resolve(selection.providerId, selection.modelId);
    for (let attempt = 0; ; attempt += 1) {
      signal.throwIfAborted();
      const wait = provider.id === 'groq' && provider.prepare ? this.budget.minuteDelay(client) : 0;
      if (wait > 0) {
        input.onTelemetry?.({ type: 'wait', milliseconds: wait, reason: 'budget' });
        await waitForRateLimit(wait, signal);
      }
      const release = await provider.prepare?.({ ...input, model, signal });
      try {
        return await this.execute(client, signal, (abortSignal) => provider.generate({ ...input, model, signal: abortSignal }));
      } catch (error) {
        // One transport retry at most. Pacing is outside the 45s HTTP timeout;
        // every actual attempt still consumes the shared request budget.
        if (!(error instanceof TransientRateLimitError) || attempt >= 1) throw error;
      } finally { release?.(); }
    }
  }
}
