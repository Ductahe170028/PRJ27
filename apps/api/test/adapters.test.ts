import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '@game-creator/contracts';
import { GeminiProvider } from '../src/providers/gemini-provider.js';
import { GroqProvider } from '../src/providers/groq-provider.js';
import { MODEL_CATALOG } from '../src/providers/model-catalog.js';
import { briefJsonSchema } from '../src/shooter/prompt.js';

const sdk = vi.hoisted(() => ({ geminiOptions: vi.fn(), groqOptions: vi.fn(), geminiGenerate: vi.fn(), groqGenerate: vi.fn(), geminiGet: vi.fn(), groqList: vi.fn(), groqGet: vi.fn() }));
vi.mock('@google/genai', async (importOriginal) => ({ ...await importOriginal<typeof import('@google/genai')>(), GoogleGenAI: class {
  constructor(options: unknown) { sdk.geminiOptions(options); }
  models = { generateContent: sdk.geminiGenerate, get: sdk.geminiGet };
} }));
vi.mock('groq-sdk', () => ({ default: class {
  constructor(options: unknown) { sdk.groqOptions(options); }
  chat = { completions: { create: (...args: unknown[]) => ({ withResponse: async () => ({ data: await sdk.groqGenerate(...args), response: new Response() }) }) } };
  models = { retrieve: sdk.groqGet, list: sdk.groqList };
} }));
const model = (id: string): ModelInfo => {
  const found = Object.values(MODEL_CATALOG).flat().find((item) => item.id === id);
  if (!found) throw new Error('Missing test model');
  return found;
};
// No catalog model needs JSON mode today; keep the fallback path covered.
const jsonModeModel: ModelInfo = { id: 'example/json-mode-model', name: 'JSON mode', capabilities: { outputMode: 'json_mode', structuredOutput: false } };
const input = (target: string | ModelInfo) => ({ model: typeof target === 'string' ? model(target) : target, prompt: 'Create a game', systemPrompt: 'Return JSON', jsonSchema: briefJsonSchema(), signal: new AbortController().signal });

beforeEach(() => vi.resetAllMocks());
describe('official SDK adapters with mocked transports', () => {
  it.each([['gemini-3.5-flash-lite', 'MINIMAL'], ['gemini-3.6-flash', 'MINIMAL'], ['gemini-3.8-flash', 'LOW']])(
    'uses Gemini structured output for %s with thinking level %s, one attempt and a token cap', async (id, level) => {
      sdk.geminiGenerate.mockResolvedValue({ text: '{}', candidates: [{ finishReason: 'STOP' }] });
      await expect(new GeminiProvider('test-key').generate(input(id))).resolves.toBe('{}');
      expect(sdk.geminiOptions).toHaveBeenCalledWith(expect.objectContaining({ httpOptions: { timeout: 45000, retryOptions: { attempts: 1 } } }));
      const request = sdk.geminiGenerate.mock.calls[0]?.[0];
      expect(request).toMatchObject({ model: id, contents: 'Create a game', config: {
        systemInstruction: 'Return JSON', responseMimeType: 'application/json', responseJsonSchema: briefJsonSchema(),
        maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: level },
      } });
      // Deprecated for Gemini 3.5+ and an error in future generations.
      expect(request.config).not.toHaveProperty('temperature');
      expect(request.config.thinkingConfig).not.toHaveProperty('thinkingBudget');
    },
  );
  it.each([['openai/gpt-oss-20b'], ['openai/gpt-oss-120b']])('uses Groq strict JSON schema with low reasoning for %s', async (id) => {
    sdk.groqGenerate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] });
    await new GroqProvider('test-key').generate(input(id));
    expect(sdk.groqOptions).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, timeout: 45000 }));
    expect(sdk.groqGenerate).toHaveBeenCalledWith(expect.objectContaining({
      model: id, max_completion_tokens: 4096, reasoning_effort: 'low', include_reasoning: false,
      response_format: { type: 'json_schema', json_schema: { name: 'shooter_brief_v1', strict: true, schema: briefJsonSchema() } },
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it('falls back to Groq JSON mode for models without strict schema support', async () => {
    sdk.groqGenerate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] });
    await new GroqProvider('test-key').generate(input(jsonModeModel));
    const request = sdk.groqGenerate.mock.calls[0]?.[0];
    expect(request.response_format).toEqual({ type: 'json_object' });
    expect(request).not.toHaveProperty('reasoning_effort');
  });
  it('checks metadata only for explicit test-connection requests', async () => {
    const signal = new AbortController().signal;
    sdk.groqList.mockResolvedValue({ data: [{ id: 'openai/gpt-oss-20b', active: true }] });
    await new GeminiProvider('test-key').testConnection(model('gemini-3.5-flash-lite'), signal);
    await new GroqProvider('test-key').testConnection(model('openai/gpt-oss-20b'), signal);
    expect(sdk.geminiGet).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.5-flash-lite' }));
    expect(sdk.groqList).toHaveBeenCalledOnce();
    expect(sdk.groqGet).not.toHaveBeenCalled();
    expect(sdk.geminiGenerate).not.toHaveBeenCalled(); expect(sdk.groqGenerate).not.toHaveBeenCalled();
  });
  it.each([{ data: [] }, { data: [{ id: 'unapproved-model' }] }, { data: [{ id: 'openai/gpt-oss-20b', active: false }] }])('does not claim a missing/inactive model is available %#', async ({ data }) => {
    sdk.groqList.mockResolvedValue({ data });
    await expect(new GroqProvider('test-key').testConnection(model('openai/gpt-oss-20b'), new AbortController().signal)).rejects.toMatchObject({ code: 'invalid_model' });
    expect(sdk.groqGenerate).not.toHaveBeenCalled(); expect(sdk.groqGet).not.toHaveBeenCalled();
  });
  it('rejects truncated or blocked results before parsing', async () => {
    sdk.geminiGenerate.mockResolvedValue({ text: '{}', candidates: [{ finishReason: 'MAX_TOKENS' }] });
    sdk.groqGenerate.mockResolvedValue({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] });
    await expect(new GeminiProvider('test-key').generate(input('gemini-3.5-flash-lite'))).rejects.toMatchObject({ code: 'invalid_game_spec' });
    await expect(new GroqProvider('test-key').generate(input('openai/gpt-oss-20b'))).rejects.toMatchObject({ code: 'invalid_game_spec' });
  });
  it('refuses to call the SDK without a key', async () => {
    await expect(new GeminiProvider('').generate(input('gemini-3.5-flash-lite'))).rejects.toMatchObject({ code: 'missing_key' });
    await expect(new GroqProvider('').testConnection(model('openai/gpt-oss-20b'), new AbortController().signal)).rejects.toMatchObject({ code: 'missing_key' });
    expect(sdk.geminiOptions).not.toHaveBeenCalled(); expect(sdk.groqOptions).not.toHaveBeenCalled();
  });
  it('normalizes quota errors without exposing SDK payloads', async () => {
    sdk.geminiGenerate.mockRejectedValue({ status: 429, message: 'secret-key {"retryDelay":"12s"}' });
    const error = await new GeminiProvider('test-key').generate(input('gemini-3.5-flash-lite')).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'rate_limit', status: 429, retryAfterSeconds: 12 });
    expect(String((error as Error).message)).not.toContain('secret-key');
    expect(sdk.geminiGenerate).toHaveBeenCalledOnce();
  });
});
