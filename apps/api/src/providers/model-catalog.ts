import type { ModelInfo } from '@game-creator/contracts';

// Only IDs the providers list with free-tier pricing/limits and structured
// output support (verified 2026-11-03). The first entry is the server default.
// Gemini 2.5 models are omitted: access is limited to projects that already used them.
// Groq llama-3.3-70b-versatile is omitted: shut down for free/developer tier on 2026-08-16.
// https://ai.google.dev/gemini-api/docs/pricing
// https://ai.google.dev/gemini-api/docs/deprecations
// https://console.groq.com/docs/rate-limits
// https://console.groq.com/docs/structured-outputs
function model(id: string, name: string, outputMode: 'json_schema' | 'json_mode'): ModelInfo {
  return { id, name, capabilities: { outputMode, structuredOutput: outputMode === 'json_schema' } };
}
export const MODEL_CATALOG: Readonly<Record<string, readonly ModelInfo[]>> = {
  gemini: [
    model('gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite', 'json_schema'),
    model('gemini-3.6-flash', 'Gemini 3.6 Flash', 'json_schema'),
    model('gemini-3.8-flash', 'Gemini 3.8 Flash', 'json_schema'),
  ],
  groq: [
    model('openai/gpt-oss-20b', 'GPT OSS 20B', 'json_schema'),
    model('openai/gpt-oss-120b', 'GPT OSS 120B', 'json_schema'),
  ],
};
