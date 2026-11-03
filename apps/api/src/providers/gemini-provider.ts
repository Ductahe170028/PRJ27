import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { ModelInfo } from '@game-creator/contracts';
import type { AIProvider, AIRequest } from './ai-provider.js';
import { AIError, normalizeProviderError } from './errors.js';

// Gemini 3.x uses thinking_level (not thinking_budget) and supports different
// levels per model; gemini-3.8-flash rejects MINIMAL. Thinking tokens count
// toward maxOutputTokens. https://ai.google.dev/gemini-api/docs/thinking
const THINKING_LEVEL: Readonly<Record<string, ThinkingLevel>> = {
  'gemini-3.5-flash-lite': ThinkingLevel.MINIMAL,
  'gemini-3.6-flash': ThinkingLevel.MINIMAL,
  'gemini-3.8-flash': ThinkingLevel.LOW,
};

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini';
  readonly name = 'Google Gemini';
  constructor(private readonly apiKey: string) {}

  private client() {
    if (!this.apiKey) throw new AIError('missing_key', 'Gemini chưa có API key ở backend.', 503);
    return new GoogleGenAI({ apiKey: this.apiKey, httpOptions: { timeout: 45_000, retryOptions: { attempts: 1 } } });
  }

  async generate(request: AIRequest): Promise<string> {
    try {
      // Sampling parameters (temperature/top_p/top_k) are deprecated for Gemini 3.5+.
      const response = await this.client().models.generateContent({
        model: request.model.id,
        contents: request.prompt,
        config: {
          systemInstruction: request.systemPrompt,
          responseMimeType: 'application/json',
          responseJsonSchema: request.jsonSchema,
          maxOutputTokens: request.maxOutputTokens ?? 8_192,
          thinkingConfig: { thinkingLevel: THINKING_LEVEL[request.model.id] ?? ThinkingLevel.LOW },
          abortSignal: request.signal,
        },
      });
      if (response.candidates?.[0]?.finishReason !== 'STOP') {
        throw new AIError('invalid_game_spec', 'Gemini trả về nội dung bị chặn hoặc chưa hoàn chỉnh. Hãy rút gọn mô tả và thử lại.', 422);
      }
      return response.text ?? '';
    } catch (error) { throw normalizeProviderError(error); }
  }

  async testConnection(model: ModelInfo, signal: AbortSignal) {
    try {
      await this.client().models.get({ model: model.id, config: { abortSignal: signal } });
    } catch (error) { throw normalizeProviderError(error); }
  }
}
