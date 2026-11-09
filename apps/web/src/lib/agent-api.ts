import type { AgentEvent, ProviderSelection } from '@game-creator/contracts';
import { fetchJson, fetchResponse, requestSelection, responseError } from './api-client';
import { readAgentStream } from './agent-stream';

export async function getAgentConfig(signal: AbortSignal): Promise<{ enabled: boolean; message: string }> {
  const body = await fetchJson('/api/agent/config', {}, signal);
  if (!body || typeof body !== 'object' || !('enabled' in body) || typeof body.enabled !== 'boolean' || !('message' in body) || typeof body.message !== 'string') throw new Error('Cấu hình Advanced không hợp lệ.');
  return { enabled: body.enabled, message: body.message };
}

export async function generateAdvanced(prompt: string, selection: ProviderSelection, signal: AbortSignal, emit: (event: AgentEvent) => void): Promise<void> {
  const response = await fetchResponse('/api/agent/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, ...requestSelection(selection) }),
  }, signal, 255_000);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw responseError(body, response.status, `Advanced trả lỗi HTTP ${response.status}.`);
  }
  if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Luồng trạng thái Advanced không hợp lệ.');
  }
  await readAgentStream(response.body, emit);
}
