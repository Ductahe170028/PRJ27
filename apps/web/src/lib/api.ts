import { GenerateGameResponseSchema, GenerateShooterResponseSchema, HealthResponseSchema, ProvidersResponseSchema, TestConnectionResponseSchema, type ProviderSelection } from '@game-creator/contracts';
import { fetchJson, requestSelection } from './api-client';
export { ApiRequestError, describeError } from './api-client';
export type { ApiIssue } from './api-client';

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

/** The shooter: the prompt becomes a level on the server (brief, compiler, bot gate). */
export async function generateShooter(prompt: string, selection: ProviderSelection, signal: AbortSignal) {
  const body = await fetchJson('/api/shooter/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, ...requestSelection(selection) }),
  }, signal);
  const result = GenerateShooterResponseSchema.safeParse(body);
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
