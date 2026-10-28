import { ApiErrorSchema, GenerateGameResponseSchema, HealthResponseSchema, ProvidersResponseSchema, TestConnectionResponseSchema, type ProviderSelection } from '@game-creator/contracts';

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

async function fetchJson(path: string, options: RequestInit, signal: AbortSignal): Promise<unknown> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = ApiErrorSchema.safeParse(body);
      throw new Error(error.success ? error.data.error.message : `Backend trả về lỗi HTTP ${response.status}. Hãy kiểm tra server và thử lại.`);
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
    body: JSON.stringify({ prompt, ...selection }),
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
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selection),
  }, signal));
  if (!parsed.success) throw new Error('Phản hồi kiểm tra kết nối không hợp lệ.');
  return parsed.data;
}
