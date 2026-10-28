import { GoogleGenAI } from '@google/genai';
import type { ModelInfo } from '@game-creator/contracts';
import type { AIProvider, AIRequest } from './ai-provider.js';
import { AIError, normalizeProviderError } from './errors.js';

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
      const response = await this.client().models.generateContent({
        model: request.model.id,
        contents: request.prompt,
        config: {
          systemInstruction: request.systemPrompt,
          responseMimeType: 'application/json',
          responseJsonSchema: request.jsonSchema,
          maxOutputTokens: 4_096,
          thinkingConfig: { thinkingBudget: 0 },
          temperature: 0.6,
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
