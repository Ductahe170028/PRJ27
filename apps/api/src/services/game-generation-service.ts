import { randomUUID } from 'node:crypto';
import {
  AIGameProjectSchema, GAME_SPEC_MAX_BYTES, GameSpecPlacementInputSchema,
  type GenerateGameRequest, type ProviderRequestSelection,
} from '@game-creator/contracts';
import { ProviderRegistry } from '../providers/provider-registry.js';
import { AIError, TransientRateLimitError, normalizeProviderError } from '../providers/errors.js';
import { RequestBudget } from './request-budget.js';
import { GAME_SYSTEM_PROMPT, providerJsonSchema } from './system-prompt.js';
import { normalizeGeneratedSpec } from './normalize-game-spec.js';
import { repairGamePlacement } from './repair-game-placement.js';
import type { AIRequest } from '../providers/ai-provider.js';
import { waitForRateLimit } from '../providers/groq-rate-limit.js';

export function parseGameSpec(text: string) {
  if (Buffer.byteLength(text, 'utf8') > GAME_SPEC_MAX_BYTES) throw new AIError('invalid_game_spec', 'GameSpec vượt quá giới hạn 32 KB.', 422);
  // A single fenced JSON block can be unwrapped safely; nothing is evaluated.
  const clean = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
  let data: unknown;
  try { data = JSON.parse(clean); } catch { throw new AIError('invalid_game_spec', 'Provider không trả về JSON hợp lệ. Hãy thử mô tả đơn giản hơn.', 422); }
  const normalized = normalizeGeneratedSpec(data);
  const parsed = GameSpecPlacementInputSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new AIError('invalid_game_spec', 'Dữ liệu màn chơi không hợp lệ hoặc không thể chơi an toàn. Hãy đơn giản hóa mô tả rồi thử lại.', 422, undefined,
      parsed.error.issues.slice(0, 5).map((issue) => issue.path.map(String).join('.')));
  }
  return repairGamePlacement(parsed.data);
}

export class GameGenerationService {
  constructor(
    readonly registry: ProviderRegistry,
    private readonly budget = new RequestBudget(),
    private readonly timeoutMs = 45_000,
  ) {}

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
    const text = await this.execute(client, signal, (abortSignal) => provider.generate({
      prompt: request.prompt, model, signal: abortSignal,
      systemPrompt: GAME_SYSTEM_PROMPT, jsonSchema: providerJsonSchema(),
    }));
    const game = parseGameSpec(text);
    return AIGameProjectSchema.parse({
      id: randomUUID(), title: game.title, prompt: request.prompt,
      provider: provider.id, modelId: model.id, capabilities: model.capabilities,
      createdAt: new Date().toISOString(), game,
    });
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
