import { AsyncLocalStorage } from 'node:async_hooks';

/** Safe provider metadata. Callers must not put headers, API keys, or upstream secrets here. */
export interface ProviderExchange {
  provider: string;
  model: string;
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
  contentPresent: boolean;
  rawContent?: string;
  failedGenerationPresent?: boolean;
  schemaPath?: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; reasoningTokens: number } | null;
  responseFormat?: unknown;
}

export interface DiagnosticSink {
  note(exchange: ProviderExchange): Promise<void>;
}

export const diagnosticSink = new AsyncLocalStorage<DiagnosticSink>();
