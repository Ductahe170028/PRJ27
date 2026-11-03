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
