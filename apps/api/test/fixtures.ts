import { readFileSync } from 'node:fs';
import type { AIProvider, AIRequest } from '../src/providers/ai-provider.js';
import { MODEL_CATALOG } from '../src/providers/model-catalog.js';
import { ProviderRegistry } from '../src/providers/provider-registry.js';

/** A valid brief (what the model answers with): test/fixtures/shooter/ok-zombie.json, as a fresh object each time. */
export function sampleBrief(): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL('./fixtures/shooter/ok-zombie.json', import.meta.url), 'utf8')) as Record<string, unknown>;
}

export function mockProvider(id = 'gemini', generate: (request: AIRequest) => Promise<string> = async () => JSON.stringify(sampleBrief())): AIProvider {
  return { id, name: id === 'gemini' ? 'Google Gemini' : 'Groq', generate, testConnection: async () => {} };
}

export function mockRegistry(providers = [mockProvider(), mockProvider('groq')]) {
  return new ProviderRegistry(providers.map((provider) => ({
    provider, configured: true, models: MODEL_CATALOG[provider.id] ?? [],
  })));
}
