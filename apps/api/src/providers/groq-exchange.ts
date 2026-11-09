import type { ProviderExchange } from './diagnostic-sink.js';
import { groqErrorDetail, responseFormatDiagnostic, safeSchemaPath } from './groq-rate-limit.js';

interface GroqUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
}

export interface GroqExchangeInput {
  provider: string;
  model: string;
  responseFormat: unknown;
  httpStatus?: number;
  content?: string;
  usage?: GroqUsage | null;
  cause?: unknown;
  fallbackMessage?: string;
  fallbackCode?: string;
}

function mapUsage(usage: GroqUsage | null | undefined): ProviderExchange['usage'] {
  if (!usage || typeof usage.prompt_tokens !== 'number' || typeof usage.completion_tokens !== 'number' || typeof usage.total_tokens !== 'number') return null;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

/** Describes one Groq HTTP result without headers or the upstream error message. */
export function buildGroqExchange(input: GroqExchangeInput): ProviderExchange {
  const detail = input.cause === undefined ? {} : groqErrorDetail(input.cause);
  const failed = typeof detail.failed_generation === 'string' ? detail.failed_generation.slice(0, 65_536) : undefined;
  const content = failed ?? input.content ?? '';
  const exchange: ProviderExchange = {
    provider: input.provider,
    model: input.model,
    contentPresent: content.length > 0,
    usage: mapUsage(input.usage),
    responseFormat: responseFormatDiagnostic(input.responseFormat),
  };
  if (input.httpStatus !== undefined && Number.isFinite(input.httpStatus)) exchange.httpStatus = input.httpStatus;
  const code = typeof detail.code === 'string' ? detail.code : input.fallbackCode;
  if (code) exchange.errorCode = code;
  if (input.fallbackMessage && ((input.httpStatus ?? 0) >= 400 || input.cause !== undefined)) exchange.errorMessage = input.fallbackMessage;
  if (content) exchange.rawContent = content;
  if (input.cause !== undefined) exchange.failedGenerationPresent = failed !== undefined;
  const schemaPath = safeSchemaPath(detail.schema_path);
  if (schemaPath) exchange.schemaPath = schemaPath;
  return exchange;
}
