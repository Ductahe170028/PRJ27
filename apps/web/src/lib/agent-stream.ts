import { AgentEventSchema, type AgentEvent } from '@game-creator/contracts';

export async function readAgentStream(body: ReadableStream<Uint8Array>, emit: (event: AgentEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', total = 0;
  let terminal: AgentEvent | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    let data: unknown;
    try { data = JSON.parse(line); }
    catch { throw new Error('Dữ liệu trạng thái Advanced không hợp lệ.'); }
    const parsed = AgentEventSchema.safeParse(data);
    if (!parsed.success || terminal) throw new Error('Dữ liệu trạng thái Advanced không hợp lệ.');
    // Commit the final event only once the entire response has been validated.
    if (parsed.data.type === 'completed' || parsed.data.type === 'failed') terminal = parsed.data;
    else emit(parsed.data);
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
    emit(terminal);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
