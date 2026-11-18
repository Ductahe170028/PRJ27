import { readIntEnv } from '../config/env.js';
import { DockerGameTester } from '../sandbox/docker-game-tester.js';
import { readSandboxConfig } from '../sandbox/docker-args.js';
import { DockerSandbox } from '../sandbox/docker-sandbox.js';
import type { GameGenerationService } from '../services/game-generation-service.js';
import { JobQueue, type JobQueueOptions } from '../services/job-queue.js';
import { PlaywrightGameTester, type GameTester } from './game-tester.js';
import { AgentOrchestrator } from './orchestrator.js';

/** A client waits at most this long for a slot, then runs at most this long. The
 * browser gives up after 330 s, so the sum must stay below that. */
const MAX_TOTAL_MS = 300_000;

/** Conservative for a 2 vCPU / 2 GB host: one job at a time, a short queue. */
export function readJobQueueOptions(env: NodeJS.ProcessEnv): JobQueueOptions {
  const options: JobQueueOptions = {
    concurrency: readIntEnv(env, 'GAME_JOB_CONCURRENCY', 1, 1, 2),
    maxQueue: readIntEnv(env, 'GAME_JOB_MAX_QUEUE', 2, 0, 10),
    runTimeoutMs: readIntEnv(env, 'GAME_JOB_TIMEOUT_MS', 240_000, 30_000, MAX_TOTAL_MS),
    maxWaitMs: readIntEnv(env, 'GAME_JOB_MAX_WAIT_MS', 60_000, 5_000, MAX_TOTAL_MS),
    maxPerOwner: readIntEnv(env, 'GAME_JOB_MAX_PER_IP', 2, 1, 5),
  };
  if (options.runTimeoutMs + (options.maxWaitMs ?? 0) > MAX_TOTAL_MS) {
    throw new Error(`GAME_JOB_TIMEOUT_MS + GAME_JOB_MAX_WAIT_MS không được vượt ${MAX_TOTAL_MS} ms (trình duyệt dừng chờ sau 330 giây).`);
  }
  return options;
}

/** Docker is the default. `local` runs Chromium on this machine with this
 * process's rights; it exists for development and is refused in production. */
export function createTester(env: NodeJS.ProcessEnv): GameTester {
  const mode = (env.ADVANCED_TESTER?.trim() || 'docker').toLowerCase();
  if (mode === 'docker') return new DockerGameTester(new DockerSandbox(readSandboxConfig(env)));
  if (mode === 'local') {
    if (env.NODE_ENV === 'production') throw new Error('ADVANCED_TESTER=local chạy Chromium trên máy chủ nên bị cấm khi NODE_ENV=production.');
    console.warn('[advanced] ADVANCED_TESTER=local: Chromium chạy trực tiếp trên máy này. Chỉ dùng để phát triển.');
    return new PlaywrightGameTester();
  }
  throw new Error('ADVANCED_TESTER chỉ nhận "docker" hoặc "local".');
}

export function createAgent(generation: GameGenerationService, env: NodeJS.ProcessEnv): AgentOrchestrator {
  return new AgentOrchestrator(generation, createTester(env), undefined, undefined, new JobQueue(readJobQueueOptions(env)));
}
