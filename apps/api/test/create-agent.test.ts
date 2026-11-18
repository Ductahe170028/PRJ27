import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgent, createTester, readJobQueueOptions } from '../src/agent/create-agent.js';
import { PlaywrightGameTester } from '../src/agent/game-tester.js';
import { DockerGameTester } from '../src/sandbox/docker-game-tester.js';
import { GameGenerationService } from '../src/services/game-generation-service.js';
import { mockProvider, mockRegistry } from './fixtures.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('readJobQueueOptions', () => {
  it('defaults to a conservative profile for a 2 vCPU / 2 GB host', () => {
    expect(readJobQueueOptions({})).toEqual({ concurrency: 1, maxQueue: 2, runTimeoutMs: 240_000, maxWaitMs: 60_000, maxPerOwner: 2 });
  });
  it('reads every GAME_JOB_* variable', () => {
    expect(readJobQueueOptions({ GAME_JOB_CONCURRENCY: '2', GAME_JOB_MAX_QUEUE: '5', GAME_JOB_TIMEOUT_MS: '120000', GAME_JOB_MAX_WAIT_MS: '30000', GAME_JOB_MAX_PER_IP: '3' }))
      .toEqual({ concurrency: 2, maxQueue: 5, runTimeoutMs: 120_000, maxWaitMs: 30_000, maxPerOwner: 3 });
  });
  it.each([
    ['GAME_JOB_CONCURRENCY', '0'], ['GAME_JOB_CONCURRENCY', '9'], ['GAME_JOB_MAX_QUEUE', '-1'], ['GAME_JOB_MAX_QUEUE', '1000'], ['GAME_JOB_TIMEOUT_MS', 'abc'], ['GAME_JOB_TIMEOUT_MS', '100'],
    ['GAME_JOB_MAX_WAIT_MS', '1'], ['GAME_JOB_MAX_PER_IP', '0'], ['GAME_JOB_MAX_PER_IP', '1.5'],
  ])('refuses %s=%s instead of silently using another value', (name, value) => {
    expect(() => readJobQueueOptions({ [name]: value })).toThrow(new RegExp(name));
  });
  it('refuses settings whose wait + run time exceeds what the browser and Nginx tolerate', () => {
    expect(() => readJobQueueOptions({ GAME_JOB_TIMEOUT_MS: '300000', GAME_JOB_MAX_WAIT_MS: '60000' })).toThrow(/300000/);
    expect(() => readJobQueueOptions({ GAME_JOB_TIMEOUT_MS: '240000', GAME_JOB_MAX_WAIT_MS: '60000' })).not.toThrow();
  });
});

describe('createTester', () => {
  it('uses the Docker sandbox by default, including in production', () => {
    expect(createTester({})).toBeInstanceOf(DockerGameTester);
    expect(createTester({ NODE_ENV: 'production' })).toBeInstanceOf(DockerGameTester);
    expect(createTester({ ADVANCED_TESTER: 'docker', NODE_ENV: 'production' })).toBeInstanceOf(DockerGameTester);
  });
  it('allows the host Chromium tester only outside production, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(createTester({ ADVANCED_TESTER: 'local' })).toBeInstanceOf(PlaywrightGameTester);
    expect(warn).toHaveBeenCalledOnce();
  });
  it('refuses the host tester in production: there is no fallback to running AI code on the server', () => {
    expect(() => createTester({ ADVANCED_TESTER: 'local', NODE_ENV: 'production' })).toThrow(/production/);
    expect(() => createTester({ ADVANCED_TESTER: 'LOCAL', NODE_ENV: 'production' })).toThrow(/production/);
  });
  it('refuses unknown modes', () => {
    expect(() => createTester({ ADVANCED_TESTER: 'none' })).toThrow(/ADVANCED_TESTER/);
    expect(() => createTester({ ADVANCED_TESTER: 'host' })).toThrow(/ADVANCED_TESTER/);
  });
  it('rejects an unpinned sandbox image', () => {
    expect(() => createTester({ SANDBOX_IMAGE: 'gamecreator-sandbox:latest' })).toThrow(/SANDBOX_IMAGE/);
  });
});

describe('createAgent', () => {
  it('builds an orchestrator that is not ready until the sandbox self-check passes', () => {
    const agent = createAgent(new GameGenerationService(mockRegistry([mockProvider('groq')])), {});
    expect(agent.readiness().ready).toBe(false);
    expect(() => agent.reserve({ providerId: 'groq', prompt: 'Tạo game bắn máy bay' })).toThrowError(expect.objectContaining({ code: 'tester_unavailable', status: 503 }));
  });
});
