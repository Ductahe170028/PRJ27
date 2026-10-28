export type AIErrorCode = 'missing_key' | 'invalid_provider' | 'invalid_model' | 'configuration_required'
  | 'rate_limit' | 'timeout' | 'provider_error' | 'invalid_game_spec' | 'cancelled';

export class AIError extends Error {
  constructor(
    public readonly code: AIErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
    public readonly issues?: string[],
  ) { super(message); }
}

export function normalizeProviderError(error: unknown): AIError {
  if (error instanceof AIError) return error;
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const status = Number(record.status ?? record.statusCode ?? 0);
  if (status === 429) return new AIError('rate_limit', 'Provider đã hết quota hoặc giới hạn tốc độ. Hãy kiểm tra quota rồi thử lại; hệ thống không tự gửi lại.', 429, 60);
  if (record.name === 'AbortError' || record.name === 'TimeoutError' || record.name === 'APIConnectionTimeoutError' || status === 408 || status === 504) {
    return new AIError('timeout', 'Provider phản hồi quá lâu. Yêu cầu đã dừng; hãy thử lại sau.', 504);
  }
  if (status === 404) return new AIError('invalid_model', 'Model không tồn tại hoặc tài khoản chưa được cấp quyền sử dụng model này.', 400);
  if (status === 401 || status === 403) return new AIError('provider_error', 'Provider từ chối API key hoặc quyền truy cập. Kiểm tra cấu hình backend.', 502);
  return new AIError('provider_error', 'Không nhận được kết quả từ provider. Kiểm tra kết nối, model và trạng thái dịch vụ rồi thử lại.', 502);
}
