import { afterEach, expect, it, vi } from 'vitest';
import { GroqProvider } from '../src/providers/groq-provider.js';
import { MODEL_CATALOG } from '../src/providers/model-catalog.js';

afterEach(() => vi.unstubAllGlobals());

// Exercise the real SDK's HTTP routing rather than mocking SDK resource methods.
it('checks a namespaced model through the list URL with the actual Groq SDK', async () => {
  const fetch = vi.fn(async (input: Request | string | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== 'https://api.groq.com/openai/v1/models') return new Response('{}', { status: 404 });
    return Response.json({ object: 'list', data: [{ id: 'openai/gpt-oss-20b', object: 'model', created: 0, owned_by: 'test' }] });
  });
  vi.stubGlobal('fetch', fetch);
  const model = MODEL_CATALOG.groq?.[0];
  if (!model) throw new Error('Missing model fixture');
  await expect(new GroqProvider('test-only-key').testConnection(model, new AbortController().signal)).resolves.toBeUndefined();
  expect(fetch).toHaveBeenCalledOnce();
});

it('reads real SDK response headers and measured usage including reasoning without double-counting', async () => {
  const fetch = vi.fn(async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"source":"code"}' } }],
    usage: { prompt_tokens: 400, completion_tokens: 900, total_tokens: 1300, completion_tokens_details: { reasoning_tokens: 200 } } },
  { headers: { 'x-ratelimit-limit-tokens': '8000', 'x-ratelimit-remaining-tokens': '6700', 'x-ratelimit-reset-tokens': '9.75s' } }));
  vi.stubGlobal('fetch', fetch);
  const onTelemetry = vi.fn();
  await new GroqProvider('test-only-key').generate({ model: MODEL_CATALOG.groq![0]!, prompt: 'game', systemPrompt: 'code', jsonSchema: {},
    maxOutputTokens: 2400, onTelemetry, signal: new AbortController().signal });
  expect(onTelemetry).toHaveBeenCalledWith(expect.objectContaining({ type: 'usage', inputTokens: 400, outputTokens: 900, totalTokens: 1300,
    reasoningTokens: 200, maxOutputTokens: 2400, limitTokens: 8000, remainingTokens: 6700 }));
  expect(fetch).toHaveBeenCalledOnce();
});
