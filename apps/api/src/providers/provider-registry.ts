import { AUTO_MODEL_ID, type ModelInfo, type ProviderInfo } from '@game-creator/contracts';
import type { AIProvider } from './ai-provider.js';
import { AIError } from './errors.js';

export interface ProviderRegistration {
  provider: AIProvider;
  configured: boolean;
  /** Server allowlist in priority order; the first model is the default. */
  models: readonly ModelInfo[];
  invalidModels?: boolean;
}

export class ProviderRegistry {
  private readonly registrations = new Map<string, ProviderRegistration>();
  constructor(registrations: readonly ProviderRegistration[]) {
    for (const entry of registrations) {
      if (this.registrations.has(entry.provider.id)) throw new Error('Duplicate provider registration');
      this.registrations.set(entry.provider.id, { ...entry, models: structuredClone(entry.models) });
    }
  }

  list(): ProviderInfo[] {
    return Array.from(this.registrations.values(), (entry) => {
      const reason = !entry.configured ? 'missing_key' : entry.invalidModels ? 'invalid_model'
        : entry.models.length === 0 ? 'models_unconfigured' : null;
      return { id: entry.provider.id, name: entry.provider.name, available: reason === null, reason,
        defaultModelId: entry.models[0]?.id ?? null, models: structuredClone([...entry.models]) };
    });
  }

  resolve(providerId: string, modelId?: string) {
    const entry = this.registrations.get(providerId);
    if (!entry) throw new AIError('invalid_provider', 'Provider không được hỗ trợ.', 400);
    if (!entry.configured) throw new AIError('missing_key', `${entry.provider.name} chưa có API key ở backend.`, 503);
    if (entry.invalidModels) throw new AIError('invalid_model', 'Allowlist chứa model không được hỗ trợ. Kiểm tra file .env của backend.', 400);
    // Resolved from immutable configuration on every request; never global selection state.
    const requestedId = modelId === undefined || modelId === AUTO_MODEL_ID ? entry.models[0]?.id : modelId;
    const model = entry.models.find((candidate) => candidate.id === requestedId);
    if (!model) throw new AIError('invalid_model', 'Model chưa có trong allowlist của backend.', 400);
    return { provider: entry.provider, model: structuredClone(model) };
  }
}
