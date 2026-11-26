/** Secret redaction for the run diagnostics. */

/** Where a diagnostics writer puts its files (replaceable in tests). */
export interface DiagnosticIO {
  writeFile(file: string, data: string): Promise<void>;
}

const SECRET_KEY = /^(?:authorization|proxy-authorization|api[-_]?key|x-api-key|cookie|set-cookie|headers)$/i;
const SECRET_TEXT = /(?:bearer\s+[A-Za-z0-9._~+/-]+=*|gsk_[A-Za-z0-9]+|sk-[A-Za-z0-9]+|(?:authorization|api[_-]?key|groq_api_key|gemini_api_key)\s*[:=]\s*\S+(?:\s+\S+)?)/gi;

export function redactDiagnostics(value: string): string;
export function redactDiagnostics(value: unknown): unknown;
export function redactDiagnostics(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SECRET_TEXT, '[redacted]');
  if (Array.isArray(value)) return value.map((item) => redactDiagnostics(item));
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    output[key] = redactDiagnostics(child);
  }
  return output;
}
