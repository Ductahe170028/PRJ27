import Groq from 'groq-sdk';
import type { ModelInfo } from '@game-creator/contracts';
import type { AIProvider, AIRequest } from './ai-provider.js';
import { AIError, normalizeProviderError } from './errors.js';
import { GroqRateLimiter, estimateInputTokens } from './groq-rate-limit.js';

export class GroqProvider implements AIProvider {
  readonly id = 'groq';
  readonly name = 'Groq';
  private readonly rateLimiter = new GroqRateLimiter();
  constructor(private readonly apiKey: string) {}

  prepare(request: AIRequest) { return this.rateLimiter.acquire(request); }

  private client() {
    if (!this.apiKey) throw new AIError('missing_key', 'Groq chưa có API key ở backend.', 503);
    return new Groq({ apiKey: this.apiKey, timeout: 45_000, maxRetries: 0 });
  }

  async generate(request: AIRequest): Promise<string> {
    try {
      const { data: response, response: http } = await this.client().chat.completions.create({
        model: request.model.id,
        messages: [{ role: 'system', content: request.systemPrompt }, { role: 'user', content: request.prompt }],
        response_format: request.model.capabilities.outputMode === 'json_schema'
          ? { type: 'json_schema', json_schema: { name: 'game_spec_v1', strict: true, schema: request.jsonSchema } }
          : { type: 'json_object' },
        ...(request.model.id.startsWith('openai/gpt-oss-') ? { reasoning_effort: 'low' as const, include_reasoning: false } : {}),
        max_completion_tokens: request.maxOutputTokens ?? 4_096,
        temperature: 0.6,
      }, { signal: request.signal }).withResponse();
      const rate = this.rateLimiter.observe(request.model.id, http.headers, response.usage?.total_tokens);
      if (response.usage) request.onTelemetry?.({ type: 'usage', provider: this.id, model: request.model.id,
        inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens, totalTokens: response.usage.total_tokens,
        reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens ?? 0,
        maxOutputTokens: request.maxOutputTokens ?? 4096, estimatedInputTokens: estimateInputTokens(request),
        limitTokens: rate.limit, ...(rate.remaining !== undefined ? { remainingTokens: rate.remaining } : {}),
      });
      const choice = response.choices[0];
      if (!choice || choice.finish_reason !== 'stop') {
        throw new AIError('invalid_game_spec', 'Groq trả về nội dung chưa hoàn chỉnh. Hãy rút gọn mô tả và thử lại.', 422);
      }
      return choice.message.content ?? '';
    } catch (error) { throw this.rateLimiter.error(request.model.id, error); }
  }

  async testConnection(model: ModelInfo, signal: AbortSignal) {
    try {
      // SDK retrieve() encodes '/' in namespaced IDs; Groq can return 404 for
      // that URL even when the same model is available. List avoids this route.
      const result = await this.client().models.list({ signal });
      if (!result.data.some((item) => item.id === model.id && !('active' in item && item.active === false))) {
        throw new AIError('invalid_model', 'Đã kết nối Groq nhưng model của ứng dụng hiện không khả dụng với API key này. Không tự chuyển sang model khác.', 400);
      }
    } catch (error) { throw normalizeProviderError(error); }
  }
}
