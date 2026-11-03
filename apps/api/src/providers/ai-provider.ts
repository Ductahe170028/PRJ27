import type { ModelInfo } from '@game-creator/contracts';

export type ProviderTelemetry =
  | { type: 'usage'; provider: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; reasoningTokens: number; maxOutputTokens: number; estimatedInputTokens: number; remainingTokens?: number; limitTokens?: number }
  | { type: 'wait'; milliseconds: number; reason: 'tokens' | 'spacing' | 'retry' | 'budget' };

export interface AIRequest {
  model: ModelInfo;
  prompt: string;
  systemPrompt: string;
  jsonSchema: Record<string, unknown>;
  signal: AbortSignal;
  maxOutputTokens?: number;
  onTelemetry?: (event: ProviderTelemetry) => void;
}

export interface AIProvider {
  readonly id: string;
  readonly name: string;
  generate(request: AIRequest): Promise<string>;
  /** Advanced-only pacing, outside the per-network-request timeout/budget. */
  prepare?(request: AIRequest): Promise<() => void>;
  testConnection(model: ModelInfo, signal: AbortSignal): Promise<void>;
}
