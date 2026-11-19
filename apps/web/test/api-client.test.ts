import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateGame, ApiRequestError, describeError } from '../src/lib/api';
import { generateAdvanced, getAgentConfig } from '../src/lib/agent-api';

const selection = { providerId: 'groq', modelId: 'auto' };
const signal = () => new AbortController().signal;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('shared API error handling', () => {
  const modes = [
    { name: 'Standard', run: () => generateGame('game', selection, signal()) },
    { name: 'Advanced', run: () => generateAdvanced('game', selection, signal(), vi.fn()) },
  ];
  it.each(modes)('$name validates malformed HTTP errors instead of trusting cast fields', async ({ run }) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: { secret: 'bad' }, code: [], retryAfterSeconds: -5 } }, { status: 502 })));
    await expect(run()).rejects.toMatchObject({ message: expect.stringContaining('HTTP 502'), code: undefined, retryAfterSeconds: undefined });
  });
  it.each(modes)('$name preserves structured errors and sends auto selection without a model ID', async ({ run }) => {
    const fetch = vi.fn(async () => Response.json({ error: { code: 'rate_limit', message: 'Hết quota', retryAfterSeconds: 60 } }, { status: 429 }));
    vi.stubGlobal('fetch', fetch);
    await expect(run()).rejects.toEqual(new ApiRequestError('Hết quota', 'rate_limit', 60));
    const options = (fetch.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1];
    expect(JSON.parse(String(options.body))).toEqual({ prompt: 'game', providerId: 'groq' });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('keeps GameSpec issues with path, code and message', async () => {
    const issues = [
      { path: 'title', code: 'invalid_format', message: 'Invalid string' },
      'collectibles.0',
    ];
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: {
        code: 'invalid_game_spec',
        message: 'Dữ liệu màn chơi không hợp lệ hoặc không thể chơi an toàn. Hãy đơn giản hóa mô tả rồi thử lại.',
        issues,
      },
    }, { status: 422 })));
    const error = await generateGame('game', selection, signal()).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'invalid_game_spec', issues });
    expect(describeError(error, 'fallback').issues).toEqual(issues);
  });
  it('bounds the Advanced configuration request with the shared timeout', async () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
    })));
    const pending = getAgentConfig(signal());
    timeout.abort(new DOMException('Timed out', 'TimeoutError'));
    await expect(pending).rejects.toThrow('phản hồi quá lâu');
    expect(AbortSignal.timeout).toHaveBeenCalledWith(60_000);
  });
  it('keeps the longer timeout for Advanced generation', async () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
    })));
    const pending = generateAdvanced('game', selection, signal(), vi.fn());
    timeout.abort(new DOMException('Timed out', 'TimeoutError'));
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(AbortSignal.timeout).toHaveBeenCalledWith(330_000);
  });
  it('cancels a response with the wrong streaming content type', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/html' } })));
    await expect(generateAdvanced('game', selection, signal(), vi.fn())).rejects.toThrow('không hợp lệ');
    expect(cancel).toHaveBeenCalledOnce();
  });
});
