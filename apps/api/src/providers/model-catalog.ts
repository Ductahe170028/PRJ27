import type { ModelInfo } from '@game-creator/contracts';

// Supported IDs verified against provider docs. This is NOT an account allowlist:
// an operator must opt in via *_ALLOWED_MODELS and confirm their free-tier account.
// https://ai.google.dev/gemini-api/docs/pricing
// https://console.groq.com/docs/structured-outputs
function model(id: string, name: string, outputMode: 'json_schema' | 'json_mode'): ModelInfo {
  return { id, name, capabilities: { outputMode, structuredOutput: outputMode === 'json_schema', genres: ['platformer', 'top-down'] } };
}
export const MODEL_CATALOG: Readonly<Record<string, readonly ModelInfo[]>> = {
  gemini: [
    model('gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', 'json_schema'),
    model('gemini-2.5-flash', 'Gemini 2.5 Flash', 'json_schema'),
  ],
  groq: [
    model('openai/gpt-oss-20b', 'GPT OSS 20B', 'json_schema'),
    model('llama-3.3-70b-versatile', 'Llama 3.3 70B', 'json_mode'),
  ],
};
