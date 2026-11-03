import Groq from 'groq-sdk';
import type { ModelInfo } from '@game-creator/contracts';
import type { AIProvider, AIRequest } from './ai-provider.js';
import { AIError, normalizeProviderError } from './errors.js';

export class GroqProvider implements AIProvider {
  readonly id = 'groq';
  readonly name = 'Groq';
  constructor(private readonly apiKey: string) {}

  private client() {
    if (!this.apiKey) throw new AIError('missing_key', 'Groq chưa có API key ở backend.', 503);
    return new Groq({ apiKey: this.apiKey, timeout: 45_000, maxRetries: 0 });
  }

  async generate(request: AIRequest): Promise<string> {
    try {
      const response = await this.client().chat.completions.create({
        model: request.model.id,
        messages: [{ role: 'system', content: request.systemPrompt }, { role: 'user', content: request.prompt }],
        response_format: request.model.capabilities.outputMode === 'json_schema'
          ? { type: 'json_schema', json_schema: { name: 'game_spec_v1', strict: true, schema: request.jsonSchema } }
          : { type: 'json_object' },
        ...(request.model.id.startsWith('openai/gpt-oss-') ? { reasoning_effort: 'low' as const, include_reasoning: false } : {}),
        max_completion_tokens: request.maxOutputTokens ?? 4_096,
        temperature: 0.6,
      }, { signal: request.signal });
      const choice = response.choices[0];
      if (!choice || choice.finish_reason !== 'stop') {
        throw new AIError('invalid_game_spec', 'Groq trả về nội dung chưa hoàn chỉnh. Hãy rút gọn mô tả và thử lại.', 422);
      }
      return choice.message.content ?? '';
    } catch (error) { throw normalizeProviderError(error); }
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
