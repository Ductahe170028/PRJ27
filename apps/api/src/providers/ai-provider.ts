import type { ModelInfo } from '@game-creator/contracts';

export interface AIRequest {
  model: ModelInfo;
  prompt: string;
  systemPrompt: string;
  jsonSchema: Record<string, unknown>;
  signal: AbortSignal;
}

export interface AIProvider {
  readonly id: string;
  readonly name: string;
  generate(request: AIRequest): Promise<string>;
  testConnection(model: ModelInfo, signal: AbortSignal): Promise<void>;
}
