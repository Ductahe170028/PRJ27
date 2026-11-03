import { GeminiProvider } from './gemini-provider.js';
import { GroqProvider } from './groq-provider.js';
import { MODEL_CATALOG } from './model-catalog.js';
import { ProviderRegistry } from './provider-registry.js';

export function createProviderRegistry(env: NodeJS.ProcessEnv = process.env) {
  const providers = [new GeminiProvider(env.GEMINI_API_KEY?.trim() ?? ''), new GroqProvider(env.GROQ_API_KEY?.trim() ?? '')];
  return new ProviderRegistry(providers.map((provider) => {
    const prefix = provider.id.toUpperCase();
    const catalog = MODEL_CATALOG[provider.id] ?? [];
    // An API key is enough: an empty allowlist means the whole verified catalog.
    // *_ALLOWED_MODELS may only narrow it; unknown IDs make the provider unavailable.
    const configured = env[`${prefix}_ALLOWED_MODELS`]?.trim();
    const ids = configured
      ? [...new Set(configured.split(',').map((id) => id.trim()).filter(Boolean))]
      : catalog.map((item) => item.id);
    return {
      provider,
      configured: Boolean(env[`${prefix}_API_KEY`]?.trim()),
      models: catalog.filter((item) => ids.includes(item.id)),
      invalidModels: ids.length > 10 || ids.some((id) => !catalog.some((item) => item.id === id)),
    };
  }));
}
