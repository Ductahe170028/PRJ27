export type AIErrorCode = 'missing_key' | 'invalid_provider' | 'invalid_model'
  | 'rate_limit' | 'timeout' | 'provider_error' | 'invalid_game_spec' | 'cancelled'
  | 'invalid_code' | 'agent_failed' | 'advanced_unavailable' | 'tester_unavailable' | 'shutting_down'
  | 'invalid_brief' | 'unwinnable_level' | 'compile_timeout';

/** One GameSpec field rejection. `path` uses Zod's dotted path; an empty path is the object root. */
export interface SpecIssue {
  path: string;
  code: string;
  message: string;
}

export class AIError extends Error {
  constructor(
    public readonly code: AIErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
    public readonly issues?: string[],
    public readonly details?: SpecIssue[],
  ) { super(message); }
}

/** Internal scheduling metadata; the public error JSON stays unchanged. */
export class TransientRateLimitError extends AIError {
  constructor(readonly waitMs: number) {
    super('rate_limit', 'Groq đang giới hạn tốc độ. Cần chờ quota được khôi phục.', 429, Math.ceil(waitMs / 1000));
  }
}

export class RequestCapacityError extends AIError {
  constructor(readonly tokenLimit: number, readonly inputTokens: number, readonly outputTokens: number) {
    super('rate_limit', `Một request cần khoảng ${inputTokens + outputTokens} token, vượt giới hạn ${tokenLimit} token/phút. Cần chia nhỏ công việc; chờ không làm request này nhỏ hơn.`, 429);
  }
}

/** Structured output failed. failedGeneration is model text when Groq returned
 * one; schemaPath is a provider schema pointer. Neither is copied into the HTTP
 * response or API-key logs. Standard diagnostics may store the redacted text. */
export class StructuredOutputError extends AIError {
  readonly providerStatus?: number;
  constructor(message: string, readonly failedGeneration?: string, readonly schemaPath?: string, providerStatus?: number) {
    super('invalid_code', message, 422);
    if (providerStatus !== undefined) this.providerStatus = providerStatus;
  }
}

const DEFAULT_RETRY_SECONDS = 60;

function positiveSeconds(value: unknown): number | undefined {
  const seconds = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(3_600, Math.ceil(seconds)) : undefined;
}

// Groq sends a retry-after header; Gemini embeds google.rpc.RetryInfo in the message.
// Only a number is extracted. The upstream message itself is never forwarded.
function retryAfter(record: Record<string, unknown>): number {
  const headers = record.headers;
  const header = headers instanceof Headers ? headers.get('retry-after')
    : typeof headers === 'object' && headers !== null ? (headers as Record<string, unknown>)['retry-after'] : undefined;
  const delay = typeof record.message === 'string' ? /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(record.message)?.[1] : undefined;
  return positiveSeconds(header) ?? positiveSeconds(delay) ?? DEFAULT_RETRY_SECONDS;
}

export function normalizeProviderError(error: unknown): AIError {
  if (error instanceof AIError) return error;
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const status = Number(record.status ?? record.statusCode ?? 0);
  const body = typeof record.error === 'object' && record.error !== null ? record.error as Record<string, unknown> : {};
  if (status === 429) {
    return new AIError('rate_limit', 'Provider báo hết quota hoặc vượt giới hạn tốc độ của gói hiện tại. Hệ thống không tự gửi lại; hãy chờ rồi thử lại.', 429, retryAfter(record));
  }
  if (status === 413) {
    return new AIError('rate_limit', 'Yêu cầu vượt giới hạn token mỗi phút của gói hiện tại. Hãy rút gọn mô tả hoặc chờ một phút rồi thử lại.', 429, retryAfter(record));
  }
  if (record.name === 'AbortError' || record.name === 'TimeoutError' || record.name === 'APIConnectionTimeoutError' || status === 408 || status === 504) {
    return new AIError('timeout', 'Provider phản hồi quá lâu. Yêu cầu đã dừng; hãy thử lại sau.', 504);
  }
  if (status === 400 && body.code === 'json_validate_failed') {
    return new AIError('invalid_game_spec', 'Provider không tạo được JSON đúng GameSpec. Hãy đơn giản hóa mô tả rồi thử lại.', 422);
  }
  if (status === 404) return new AIError('invalid_model', 'Model không tồn tại hoặc tài khoản chưa được cấp quyền sử dụng model này.', 400);
  if (status === 401 || status === 403) return new AIError('provider_error', 'Provider từ chối API key hoặc quyền truy cập. Kiểm tra cấu hình backend.', 502);
  if (status === 500 || status === 502 || status === 503) {
    return new AIError('provider_error', 'Dịch vụ của provider đang lỗi hoặc quá tải. Hãy thử lại sau ít phút.', 502);
  }
  return new AIError('provider_error', 'Không nhận được kết quả từ provider. Kiểm tra kết nối, model và trạng thái dịch vụ rồi thử lại.', 502);
}
