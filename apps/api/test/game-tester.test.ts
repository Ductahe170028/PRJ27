import { getEventListeners } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shooterPlan } from './agent-fixtures.js';

const mocks = vi.hoisted(() => ({ read: vi.fn(), launch: vi.fn(), connect: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.read }));
vi.mock('playwright', () => ({ chromium: { launchServer: mocks.launch, connect: mocks.connect } }));
import { PlaywrightGameTester } from '../src/agent/game-tester.js';

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
function harness() {
  const controller = new AbortController();
  const kill = vi.fn();
  const server = { close: vi.fn(async () => {}), process: () => ({ kill }), wsEndpoint: () => 'test' };
  mocks.read.mockResolvedValue('trusted runtime');
  mocks.launch.mockResolvedValue(server);
  return { controller, server, kill, run: () => new PlaywrightGameTester().test('compiled', shooterPlan, controller.signal) };
}
describe('browser tester resource lifecycle', () => {
  it('does not launch Chromium when cancelled while loading the runtime', async () => {
    const h = harness();
    mocks.read.mockImplementationOnce(async () => { h.controller.abort(); return 'runtime'; });
    await expect(h.run()).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.launch).not.toHaveBeenCalled();
  });
  it('closes a browser that finishes launching after cancellation', async () => {
    const h = harness();
    mocks.launch.mockImplementationOnce(async () => { h.controller.abort(); return h.server; });
    await expect(h.run()).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(h.server.close).toHaveBeenCalledOnce();
    expect(getEventListeners(h.controller.signal, 'abort')).toHaveLength(0);
  });
  it('closes the process and clears timers/listeners when browser setup fails', async () => {
    vi.useFakeTimers();
    const h = harness();
    mocks.connect.mockRejectedValue(new Error('connect failed'));
    expect((await h.run()).errors.join()).toContain('smoke test');
    expect(h.server.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(h.controller.signal, 'abort')).toHaveLength(0);
  });
  it('kills a renderer that does not finish testing before the deadline', async () => {
    vi.useFakeTimers();
    const h = harness();
    mocks.connect.mockImplementation(() => new Promise((_resolve, reject) => {
      h.kill.mockImplementation(() => reject(new Error('browser closed')));
    }));
    const pending = h.run();
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await pending).errors.join()).toContain('15 giây');
    expect(h.kill).toHaveBeenCalledOnce();
    expect(h.server.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps the forced-kill fallback while waiting for graceful close', async () => {
    vi.useFakeTimers();
    const h = harness();
    mocks.connect.mockRejectedValue(new Error('connect failed'));
    h.server.close.mockImplementation(() => new Promise((resolve) => { h.kill.mockImplementation(resolve); }));
    const pending = h.run();
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(h.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
