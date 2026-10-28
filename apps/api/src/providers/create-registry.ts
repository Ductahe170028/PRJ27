import { GeminiProvider } from './gemini-provider.js';
import { GroqProvider } from './groq-provider.js';
import { MODEL_CATALOG } from './model-catalog.js';
import { ProviderRegistry } from './provider-registry.js';

export function createProviderRegistry(env: NodeJS.ProcessEnv = process.env) {
  const providers = [new GeminiProvider(env.GEMINI_API_KEY?.trim() ?? ''), new GroqProvider(env.GROQ_API_KEY?.trim() ?? '')];
  return new ProviderRegistry(providers.map((provider) => {
    const prefix = provider.id.toUpperCase();
    const ids = [...new Set((env[`${prefix}_ALLOWED_MODELS`] ?? '').split(',').map((id) => id.trim()).filter(Boolean))];
    const catalog = MODEL_CATALOG[provider.id] ?? [];
    return {
      provider,
      configured: Boolean(env[`${prefix}_API_KEY`]?.trim()),
      freeTierConfirmed: env[`${prefix}_FREE_TIER_CONFIRMED`] === 'true',
      models: catalog.filter((model) => ids.includes(model.id)),
      invalidModels: ids.length > 10 || ids.some((id) => !catalog.some((model) => model.id === id)),
    };
  }));
}
