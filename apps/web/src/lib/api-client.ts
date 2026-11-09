import { AUTO_MODEL_ID, ApiErrorSchema, type ProviderSelection } from '@game-creator/contracts';

export const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

/** Backend error with its normalized code (e.g. rate_limit, missing_key). */
export class ApiRequestError extends Error {
  constructor(message: string, readonly code?: string, readonly retryAfterSeconds?: number) { super(message); }
}

export function describeError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return { message: fallback, code: '' };
  const retry = error instanceof ApiRequestError && error.retryAfterSeconds
    ? ` Có thể thử lại sau khoảng ${error.retryAfterSeconds.toLocaleString('vi-VN')} giây.` : '';
  return { message: `${error.message}${retry}`, code: error instanceof ApiRequestError ? error.code ?? '' : '' };
}

export function fetchResponse(path: string, options: RequestInit, signal: AbortSignal, timeoutMs = 60_000): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });
}

export async function fetchJson(path: string, options: RequestInit, signal: AbortSignal): Promise<unknown> {
  try {
    const response = await fetchResponse(path, options, signal);
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw responseError(body, response.status);
    }
    return body;
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error('Backend phản hồi quá lâu. Hãy kiểm tra server và thử lại.');
    }
    if (error instanceof TypeError) {
      throw new Error('Không kết nối được backend. Hãy chạy npm run dev ở thư mục gốc rồi thử lại.');
    }
    throw error;
  }
}

// "auto" is a UI preference only: omit modelId so the server picks its default.
export function requestSelection(selection: ProviderSelection) {
  return selection.modelId === AUTO_MODEL_ID ? { providerId: selection.providerId } : selection;
}

/** Treat backend/proxy errors as unknown until the shared contract validates. */
export function responseError(body: unknown, status: number, fallback = `Backend trả về lỗi HTTP ${status}. Hãy kiểm tra server và thử lại.`): ApiRequestError {
  const parsed = ApiErrorSchema.safeParse(body);
  return parsed.success
    ? new ApiRequestError(parsed.data.error.message, parsed.data.error.code, parsed.data.error.retryAfterSeconds)
    : new ApiRequestError(fallback);
}
