import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '@game-creator/contracts';
import { GeminiProvider } from '../src/providers/gemini-provider.js';
import { GroqProvider } from '../src/providers/groq-provider.js';
import { MODEL_CATALOG } from '../src/providers/model-catalog.js';
import { providerJsonSchema } from '../src/services/system-prompt.js';

const sdk = vi.hoisted(() => ({ geminiOptions: vi.fn(), groqOptions: vi.fn(), geminiGenerate: vi.fn(), groqGenerate: vi.fn(), geminiGet: vi.fn(), groqGet: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class {
  constructor(options: unknown) { sdk.geminiOptions(options); }
  models = { generateContent: sdk.geminiGenerate, get: sdk.geminiGet };
} }));
vi.mock('groq-sdk', () => ({ default: class {
  constructor(options: unknown) { sdk.groqOptions(options); }
  chat = { completions: { create: sdk.groqGenerate } };
  models = { retrieve: sdk.groqGet };
} }));
const model = (id: string): ModelInfo => {
  const found = Object.values(MODEL_CATALOG).flat().find((item) => item.id === id);
  if (!found) throw new Error('Missing test model');
  return found;
};
const input = (id: string) => ({ model: model(id), prompt: 'Create a game', systemPrompt: 'Return JSON', jsonSchema: providerJsonSchema(), signal: new AbortController().signal });

beforeEach(() => vi.resetAllMocks());
describe('official SDK adapters with mocked transports', () => {
  it('uses Gemini structured output with one attempt and a token cap', async () => {
    sdk.geminiGenerate.mockResolvedValue({ text: '{}', candidates: [{ finishReason: 'STOP' }] });
    await expect(new GeminiProvider('test-key').generate(input('gemini-2.5-flash-lite'))).resolves.toBe('{}');
    expect(sdk.geminiOptions).toHaveBeenCalledWith(expect.objectContaining({ httpOptions: { timeout: 45000, retryOptions: { attempts: 1 } } }));
    expect(sdk.geminiGenerate).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ responseMimeType: 'application/json', responseJsonSchema: providerJsonSchema(), maxOutputTokens: 4096 }) }));
  });
  it.each([['openai/gpt-oss-20b', 'json_schema'], ['llama-3.3-70b-versatile', 'json_object']])('uses the declared Groq mode for %s', async (id, type) => {
    sdk.groqGenerate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] });
    await new GroqProvider('test-key').generate(input(id!));
    expect(sdk.groqOptions).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, timeout: 45000 }));
    expect(sdk.groqGenerate).toHaveBeenCalledWith(expect.objectContaining({ response_format: expect.objectContaining({ type }), max_completion_tokens: 4096 }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it('checks metadata only for explicit test-connection requests', async () => {
    const signal = new AbortController().signal;
    await new GeminiProvider('test-key').testConnection(model('gemini-2.5-flash-lite'), signal);
    await new GroqProvider('test-key').testConnection(model('openai/gpt-oss-20b'), signal);
    expect(sdk.geminiGet).toHaveBeenCalledOnce(); expect(sdk.groqGet).toHaveBeenCalledOnce();
    expect(sdk.geminiGenerate).not.toHaveBeenCalled(); expect(sdk.groqGenerate).not.toHaveBeenCalled();
  });
  it('rejects truncated or blocked results before parsing', async () => {
    sdk.geminiGenerate.mockResolvedValue({ text: '{}', candidates: [{ finishReason: 'MAX_TOKENS' }] });
    sdk.groqGenerate.mockResolvedValue({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] });
    await expect(new GeminiProvider('test-key').generate(input('gemini-2.5-flash-lite'))).rejects.toMatchObject({ code: 'invalid_game_spec' });
    await expect(new GroqProvider('test-key').generate(input('openai/gpt-oss-20b'))).rejects.toMatchObject({ code: 'invalid_game_spec' });
  });
  it('normalizes quota errors without exposing SDK payloads', async () => {
    sdk.geminiGenerate.mockRejectedValue({ status: 429, message: 'secret-key' });
    await expect(new GeminiProvider('test-key').generate(input('gemini-2.5-flash-lite'))).rejects.toMatchObject({ code: 'rate_limit', status: 429 });
    expect(sdk.geminiGenerate).toHaveBeenCalledOnce();
  });
});
