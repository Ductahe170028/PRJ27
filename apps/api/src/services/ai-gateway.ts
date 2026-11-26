import type { ProviderRequestSelection } from '@game-creator/contracts';
import { ProviderRegistry } from '../providers/provider-registry.js';
import { AIError, TransientRateLimitError, normalizeProviderError } from '../providers/errors.js';
import { RequestBudget } from './request-budget.js';
import type { AIRequest } from '../providers/ai-provider.js';
import { waitForRateLimit } from '../providers/groq-rate-limit.js';

/** The one door to the AI providers: the request budget, the time limit, cancellation, and Groq's pacing. It knows nothing
 * about what is asked of the model; the shooter service builds the prompt and reads the answer. */
export class AiGateway {
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
