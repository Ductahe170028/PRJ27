import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, describeError, generateShooter, getProviders, testConnection } from '../src/lib/api';

const selection = { providerId: 'groq', modelId: 'auto' };
const signal = () => new AbortController().signal;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// The error handling every call shares (the shooter-specific answers are in shooter-api.test.ts).
describe('shared API error handling', () => {
  it('does not trust the fields of a malformed HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: { secret: 'bad' }, code: [], retryAfterSeconds: -5 } }, { status: 502 })));
    await expect(generateShooter('game', selection, signal())).rejects.toMatchObject({ message: expect.stringContaining('HTTP 502'), code: undefined, retryAfterSeconds: undefined });
  });

  it('preserves a structured error and sends "auto" without a model id', async () => {
    const fetch = vi.fn(async () => Response.json({ error: { code: 'rate_limit', message: 'Hết quota', retryAfterSeconds: 60 } }, { status: 429 }));
    vi.stubGlobal('fetch', fetch);
    await expect(generateShooter('game', selection, signal())).rejects.toEqual(new ApiRequestError('Hết quota', 'rate_limit', 60));
    const options = (fetch.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1];
    expect(JSON.parse(String(options.body))).toEqual({ prompt: 'game', providerId: 'groq' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps issues with path, code and message, and adds the retry time to the text shown', async () => {
    const issues = [{ path: 'theme', code: 'invalid_value', message: 'Giá trị không hợp lệ.' }, 'goal'];
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'invalid_brief', message: 'Không hợp lệ.', issues, retryAfterSeconds: 3 } }, { status: 422 })));
    const error = await generateShooter('game', selection, signal()).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'invalid_brief', issues });
    expect(describeError(error, 'fallback')).toEqual({ message: 'Không hợp lệ. Có thể thử lại sau khoảng 3 giây.', code: 'invalid_brief', issues });
    expect(describeError('not an error', 'fallback')).toEqual({ message: 'fallback', code: '', issues: [] });
  });

  it('bounds every request with the shared 60 s timeout and says so', async () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
    })));
    const pending = getProviders(signal());
    timeout.abort(new DOMException('Timed out', 'TimeoutError'));
    await expect(pending).rejects.toThrow('phản hồi quá lâu');
    expect(AbortSignal.timeout).toHaveBeenCalledWith(60_000);
  });

  it('tells the user when the backend cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(testConnection(selection, signal())).rejects.toThrow('Không kết nối được backend');
  });

  it('passes a cancellation by the caller through unchanged', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
    })));
    const pending = generateShooter('game', selection, controller.signal);
    controller.abort(new DOMException('Cancelled', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
