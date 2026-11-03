import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@game-creator/contracts';
import { readAgentStream } from '../src/lib/agent-stream';

const status: AgentEvent = { type: 'status', stage: 'Planning', message: 'Đang tạo thế giới', attempt: 0 };
const completed: AgentEvent = { type: 'completed', project: {
  id: '00000000-0000-4000-8000-000000000001', mode: 'advanced', provider: 'groq', modelId: 'test', repairs: 0,
  javascript: 'function create() {} function update() {}',
  plan: { title: 'Game', summary: 'Summary', mechanics: ['Move', 'Jump'], movement: 'horizontal', action: 'space', objective: 'Win' },
} };
const encode = (event: AgentEvent) => JSON.stringify(event);
function stream(text: string, close = true, byteChunks = false) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const data = new TextEncoder().encode(text);
      if (byteChunks) for (const byte of data) controller.enqueue(Uint8Array.of(byte));
      else controller.enqueue(data);
      if (close) controller.close();
    }, cancel,
  });
  return { body, cancel };
}

describe('Advanced NDJSON protocol', () => {
  it('decodes split UTF-8, multiple lines and a terminal event without a final newline', async () => {
    const { body } = stream(`${encode(status)}\r\n\n${encode(completed)}`, true, true);
    const events: AgentEvent[] = [];
    await readAgentStream(body, (event) => events.push(event));
    expect(events).toEqual([status, completed]);
    expect(body.locked).toBe(false);
  });
  it('rejects truncated streams rather than accepting partial progress', async () => {
    const { body } = stream(`${encode(status)}\n`);
    const emit = vi.fn();
    await expect(readAgentStream(body, emit)).rejects.toThrow('ngắt trước khi hoàn tất');
    expect(emit).toHaveBeenCalledExactlyOnceWith(status);
    expect(body.locked).toBe(false);
  });
  it.each(['not JSON', '{"type":"unknown"}', '{"type":"status"}'])('cancels an invalid open stream: %s', async (invalid) => {
    const { body, cancel } = stream(`${invalid}\n`, false);
    const emit = vi.fn();
    await expect(readAgentStream(body, emit)).rejects.toThrow('không hợp lệ');
    expect(emit).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
  it.each([encode(status), encode(completed), '{invalid'])('never publishes a completed game if data follows the terminal event', async (tail) => {
    const { body } = stream(`${encode(completed)}\n${tail}\n`);
    const emit = vi.fn();
    await expect(readAgentStream(body, emit)).rejects.toThrow('không hợp lệ');
    expect(emit).not.toHaveBeenCalled();
  });
  it('enforces the byte limit even before a newline arrives', async () => {
    const { body, cancel } = stream('ế'.repeat(70_000), false);
    await expect(readAgentStream(body, vi.fn())).rejects.toThrow('vượt giới hạn');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
  it('does not publish a completed game if the transport fails before EOF', async () => {
    const transport = new Error('connection reset');
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      if (pulls++ === 0) controller.enqueue(new TextEncoder().encode(`${encode(completed)}\n`));
      else controller.error(transport);
    } });
    const emit = vi.fn();
    await expect(readAgentStream(body, emit)).rejects.toBe(transport);
    expect(emit).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });
  it('preserves a validated quota failure and retry interval', async () => {
    const failure: AgentEvent = { type: 'failed', error: { code: 'rate_limit', message: 'Hết quota', retryAfterSeconds: 60 } };
    const { body } = stream(encode(failure));
    const emit = vi.fn(); await readAgentStream(body, emit);
    expect(emit).toHaveBeenCalledExactlyOnceWith(failure);
  });
});
