import type { ModelInfo, ProviderInfo } from '@game-creator/contracts';
import type { AIProvider } from './ai-provider.js';
import { AIError } from './errors.js';

export interface ProviderRegistration {
  provider: AIProvider;
  configured: boolean;
  freeTierConfirmed: boolean;
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
        : entry.models.length === 0 ? 'models_unconfigured' : !entry.freeTierConfirmed ? 'free_tier_unconfirmed' : null;
      return { id: entry.provider.id, name: entry.provider.name, available: reason === null, reason, models: structuredClone([...entry.models]) };
    });
  }

  resolve(providerId: string, modelId: string) {
    const entry = this.registrations.get(providerId);
    if (!entry) throw new AIError('invalid_provider', 'Provider không được hỗ trợ.', 400);
    if (!entry.configured) throw new AIError('missing_key', `${entry.provider.name} chưa có API key ở backend.`, 503);
    if (entry.invalidModels) throw new AIError('invalid_model', 'Allowlist chứa model không được hỗ trợ. Kiểm tra file .env của backend.', 400);
    const model = entry.models.find((candidate) => candidate.id === modelId);
    if (!model) throw new AIError('invalid_model', 'Model chưa có trong allowlist của backend.', 400);
    if (!entry.freeTierConfirmed) throw new AIError('configuration_required', 'Chưa xác nhận free tier của tài khoản trong cấu hình backend.', 503);
    return { provider: entry.provider, model: structuredClone(model) };
  }
}
