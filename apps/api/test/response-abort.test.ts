import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import { withResponseAbort } from '../src/http/response-abort.js';

function response() { return Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false }); }
describe('response cancellation lifecycle', () => {
  it('aborts work on disconnect and always removes the listener', async () => {
    const res = response();
    const pending = withResponseAbort(res as unknown as Response, async (signal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    res.emit('close');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(res.listenerCount('close')).toBe(0);
  });
  it('does not treat normal response completion as cancellation', async () => {
    const res = response();
    const value = await withResponseAbort(res as unknown as Response, async (signal) => {
      res.writableEnded = true; res.emit('close');
      return signal.aborted;
    });
    expect(value).toBe(false);
    expect(res.listenerCount('close')).toBe(0);
  });
  it('removes the listener when work throws', async () => {
    const res = response();
    const failure = new Error('task failed');
    await expect(withResponseAbort(res as unknown as Response, async () => { throw failure; })).rejects.toBe(failure);
    expect(res.listenerCount('close')).toBe(0);
  });
  it('passes an aborted signal if the connection is already destroyed', async () => {
    const res = response(); res.destroyed = true;
    expect(await withResponseAbort(res as unknown as Response, async (signal) => signal.aborted)).toBe(true);
    expect(res.listenerCount('close')).toBe(0);
  });
});
