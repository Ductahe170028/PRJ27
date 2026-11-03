import { AUTO_MODEL_ID, ApiErrorSchema, GenerateGameResponseSchema, HealthResponseSchema, ProvidersResponseSchema, TestConnectionResponseSchema, type ProviderSelection } from '@game-creator/contracts';

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

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

async function fetchJson(path: string, options: RequestInit, signal: AbortSignal): Promise<unknown> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = ApiErrorSchema.safeParse(body);
      if (error.success) throw new ApiRequestError(error.data.error.message, error.data.error.code, error.data.error.retryAfterSeconds);
      throw new ApiRequestError(`Backend trả về lỗi HTTP ${response.status}. Hãy kiểm tra server và thử lại.`);
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

export async function checkHealth(signal: AbortSignal) {
  const result = HealthResponseSchema.safeParse(await fetchJson('/api/health', {}, signal));
  if (!result.success) throw new Error('Phản hồi health check không hợp lệ.');
  return result.data;
}

export async function generateGame(prompt: string, selection: ProviderSelection, signal: AbortSignal) {
  const body = await fetchJson('/api/games/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, ...requestSelection(selection) }),
  }, signal);
  const result = GenerateGameResponseSchema.safeParse(body);
  if (!result.success) throw new Error('Dữ liệu game không hợp lệ. Hãy kiểm tra backend và thử lại.');
  return result.data.data;
}

export async function getProviders(signal: AbortSignal) {
  const parsed = ProvidersResponseSchema.safeParse(await fetchJson('/api/ai/providers', {}, signal));
  if (!parsed.success) throw new Error('Danh sách provider không hợp lệ.');
  return parsed.data.providers;
}

export async function testConnection(selection: ProviderSelection, signal: AbortSignal) {
  const parsed = TestConnectionResponseSchema.safeParse(await fetchJson('/api/ai/test-connection', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestSelection(selection)),
  }, signal));
  if (!parsed.success) throw new Error('Phản hồi kiểm tra kết nối không hợp lệ.');
  return parsed.data;
}

// "auto" is a UI preference only: omit modelId so the server picks its default.
function requestSelection(selection: ProviderSelection) {
  return selection.modelId === AUTO_MODEL_ID ? { providerId: selection.providerId } : selection;
}
