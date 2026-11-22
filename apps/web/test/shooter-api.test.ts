import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHOOTER_LEVELS } from '@game-creator/contracts';
import { ApiRequestError, describeError, generateShooter } from '../src/lib/api';

const selection = { providerId: 'groq', modelId: 'auto' };
const signal = () => new AbortController().signal;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const project = (patch: Record<string, unknown> = {}) => ({
  id: '3f0c4a52-1f8e-4a27-9d57-5e3a6a7a1b11', title: 'Đấu trường', prompt: 'zombie', provider: 'groq', modelId: 'openai/gpt-oss-20b',
  createdAt: '2026-11-22T10:00:00.000Z', level: SHOOTER_LEVELS.arena, notices: ['Chưa có boss'], ...patch,
});

describe('generateShooter', () => {
  it('posts to /api/shooter/generate (auto model: no modelId) and returns the parsed project', async () => {
    const fetch = vi.fn(async () => Response.json({ data: project() }, { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const result = await generateShooter('zombie', selection, signal());
    expect(result.level.kind).toBe('shooter-v1');
    expect(result.notices).toEqual(['Chưa có boss']);
    const [url, options] = (fetch.mock.calls as unknown as Array<[string, RequestInit]>)[0]!;
    expect(url).toBe('/api/shooter/generate');
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({ prompt: 'zombie', providerId: 'groq' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('sends an explicit model as it is', async () => {
    const fetch = vi.fn(async () => Response.json({ data: project() }, { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    await generateShooter('x', { providerId: 'gemini', modelId: 'gemini-3.5-flash-lite' }, signal());
    expect(JSON.parse(String((fetch.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1].body))).toEqual({ prompt: 'x', providerId: 'gemini', modelId: 'gemini-3.5-flash-lite' });
  });

  it('keeps the message, the code and the issues of a 422', async () => {
    const issues = ['theme'];
    const message = 'Mô hình trả về mô tả game không hợp lệ. Hãy thử lại hoặc diễn đạt lại ý tưởng. Lý do: Mô hình chọn một giá trị không hỗ trợ cho theme.';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'invalid_brief', message, issues } }, { status: 422 })));
    const error = await generateShooter('x', selection, signal()).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ code: 'invalid_brief', message, issues });
    expect(describeError(error, 'fallback')).toEqual({ message, code: 'invalid_brief', issues });
  });

  it('keeps an unwinnable-level error with its retry-free message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'unwinnable_level', message: 'Không dựng được màn chơi thắng được với yêu cầu này.', issues: ['goal'] } }, { status: 422 })));
    await expect(generateShooter('x', selection, signal())).rejects.toMatchObject({ code: 'unwinnable_level', issues: ['goal'] });
  });

  it('rejects a response that is not a shooter project', async () => {
    for (const body of [{ data: project({ level: { kind: 'shooter-v1' } }) }, { data: project({ notices: Array.from({ length: 9 }, (_, i) => `n${i}`) }) }, { data: { id: 1 } }, { game: {} }, null]) {
      vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, { status: 201 })));
      await expect(generateShooter('x', selection, signal())).rejects.toThrow('Dữ liệu game không hợp lệ');
    }
  });

  it('ignores a malformed error body instead of trusting it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: { secret: 'bad' }, code: [] } }, { status: 502 })));
    await expect(generateShooter('x', selection, signal())).rejects.toMatchObject({ message: expect.stringContaining('HTTP 502'), code: undefined });
  });
});
