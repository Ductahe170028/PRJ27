import { AgentEventSchema, type AgentEvent, type ProviderSelection } from '@game-creator/contracts';
import { ApiRequestError } from './api';

const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
export async function getAgentConfig(signal: AbortSignal): Promise<{ enabled: boolean; message: string }> {
  const response = await fetch(`${base}/api/agent/config`, { signal });
  if (!response.ok) throw new Error('Không đọc được cấu hình Advanced. Kiểm tra backend.');
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('enabled' in body) || typeof body.enabled !== 'boolean' || !('message' in body) || typeof body.message !== 'string') throw new Error('Cấu hình Advanced không hợp lệ.');
  return { enabled: body.enabled, message: body.message };
}

export async function generateAdvanced(prompt: string, selection: ProviderSelection, signal: AbortSignal, emit: (event: AgentEvent) => void): Promise<void> {
  const response = await fetch(`${base}/api/agent/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, providerId: selection.providerId, ...(selection.modelId === 'auto' ? {} : { modelId: selection.modelId }) }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(255_000)]),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string; code?: string; retryAfterSeconds?: number } } | null;
    throw new ApiRequestError(body?.error?.message ?? `Advanced trả lỗi HTTP ${response.status}.`, body?.error?.code, body?.error?.retryAfterSeconds);
  }
  if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) throw new Error('Luồng trạng thái Advanced không hợp lệ.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', total = 0, terminal = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const parsed = AgentEventSchema.safeParse(JSON.parse(line));
    if (!parsed.success || terminal) throw new Error('Dữ liệu trạng thái Advanced không hợp lệ.');
    emit(parsed.data);
    if (parsed.data.type === 'completed' || parsed.data.type === 'failed') terminal = true;
  };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > 200_000) throw new Error('Phản hồi Advanced vượt giới hạn.');
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
      for (const line of lines) consume(line);
    }
    buffer += decoder.decode(); if (buffer.trim()) consume(buffer);
    if (!terminal) throw new Error('Kết nối Advanced bị ngắt trước khi hoàn tất. Nhấn Retry để thử lại.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
