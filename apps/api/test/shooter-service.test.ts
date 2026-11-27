import type { Worker } from 'node:worker_threads';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  GenerateShooterResponseSchema, SHOOTER_LEVELS, ShooterLevelSchema, ShooterProjectSchema, type ShooterProject,
} from '@game-creator/contracts';
import { createApp } from '../src/app.js';
import { AIError } from '../src/providers/errors.js';
import type { AIRequest } from '../src/providers/ai-provider.js';
import { AiGateway } from '../src/services/ai-gateway.js';
import { RequestBudget } from '../src/services/request-budget.js';
import type { RunDiagnostics, DiagnosticsFinish } from '../src/services/run-diagnostics.js';
import { compileAndGate } from '../src/shooter/compile-job.js';
import { COMPILE_TIMEOUT_MESSAGE, compileInWorker, type CompileRunner } from '../src/shooter/isolated-compile.js';
import { SHOOTER_BRIEF_SYSTEM_PROMPT, briefJsonSchema } from '../src/shooter/prompt.js';
import { BRIEF_MAX_OUTPUT_TOKENS, INVALID_BRIEF_MESSAGE, NOT_JSON_MESSAGE, ShooterService, briefReason } from '../src/shooter/service.js';
import { ShooterBriefSchema } from '../src/shooter/brief.js';
import { mockProvider, mockRegistry } from './fixtures.js';

// A dev (tsx) worker can need more than the 8 s production limit just to compile
// and start, under the parallel suite. Result checks use a wide limit; the limit
// itself is tested with a tiny one.
const WIDE = 30_000;
const wide: CompileRunner = (job, signal, options) => compileInWorker(job, signal, { timeoutMs: WIDE, ...options });
const SEED = 424242;

const briefOf = (patch: Record<string, unknown> = {}) => ({
  version: 'brief-1', healthDrops: 'none', boss: 'none', base: 'none', enemyFamily: 'auto', loadout: 'all', title: 'Zombie City', theme: 'zombie-city', map: 'pillars',
  enemies: [{ type: 'runner', share: 5 }, { type: 'swarmer', share: 5 }],
  intensity: 2, playerHealth: 'normal', weapon: 'pistol', goal: { type: 'survive', seconds: 60 }, unsupported: [] as string[], ...patch,
});

function setup(answer: string | ((request: AIRequest) => Promise<string>), options: { compile?: CompileRunner; budget?: RequestBudget } = {}) {
  const seen: AIRequest[] = [];
  const provider = mockProvider('groq', async (input) => {
    seen.push(input);
    return typeof answer === 'string' ? answer : answer(input);
  });
  const generation = new AiGateway(mockRegistry([provider]), options.budget ?? new RequestBudget({ requestsPerMinute: 1000, requestsPerDay: 10000 }));
  const finished: DiagnosticsFinish[] = [];
  const diagnostics: RunDiagnostics = { async note() {}, async raw() {}, async finish(record) { finished.push(record); } };
  const service = new ShooterService(generation, { compile: options.compile ?? wide, openDiagnostics: async () => diagnostics, seed: () => SEED });
  return { service, generation, seen, finished };
}
const ask = (service: ShooterService, prompt = 'zombie', signal = new AbortController().signal) => service.generate({ prompt, providerId: 'groq' }, 'test-client', signal);
const failure = async (task: Promise<unknown>) => task.then(() => undefined, (error: unknown) => error as AIError);

describe('the shooter service', () => {
  it('turns a valid brief into a project that passes ShooterProjectSchema, and calls the provider once', async () => {
    const { service, seen, finished } = setup(JSON.stringify(briefOf()));
    const project = await ask(service, 'zombie thành phố');
    expect(ShooterProjectSchema.safeParse(project).success).toBe(true);
    expect(project).toMatchObject({ title: 'Zombie City', prompt: 'zombie thành phố', provider: 'groq', notices: [] });
    expect(project.level.seed).toBe(SEED);
    expect(seen).toHaveLength(1);
    // the same level as compiling in this process: the worker adds nothing and loses nothing
    const expected = compileAndGate({ brief: ShooterBriefSchema.parse(briefOf()), seed: SEED });
    expect(project.level).toEqual(expected.level);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ outcome: 'completed', stage: 'response', validation: { schema: 'ShooterBriefSchema', success: true } });
    expect(finished[0]!.report).toMatchObject({ wins: expect.any(Number), hpLeftAvg: expect.any(Number), thinSteps: expect.any(Number), killReductions: expect.any(Number), map: 'pillars', variant: expect.any(Number) });
  }, 60_000);

  it('gives the provider the shooter prompt, the brief schema and a 700-token budget', async () => {
    const { service, seen } = setup(JSON.stringify(briefOf()));
    await ask(service);
    expect(seen[0]).toMatchObject({ systemPrompt: SHOOTER_BRIEF_SYSTEM_PROMPT, maxOutputTokens: 700, prompt: 'zombie' });
    expect(BRIEF_MAX_OUTPUT_TOKENS).toBe(700);
    expect(seen[0]!.jsonSchema).toEqual(briefJsonSchema());
  }, 60_000);

  it('unwraps a fenced JSON block and clamps numbers instead of rejecting them', async () => {
    const text = `\`\`\`json\n${JSON.stringify(briefOf({ intensity: 9, goal: { type: 'survive', seconds: 999 }, title: 'T'.repeat(80) }))}\n\`\`\``;
    const { service, finished } = setup(text);
    const project = await ask(service);
    expect(project.level.win).toEqual({ type: 'survive', seconds: 180 });
    expect(project.title).toBe('T'.repeat(40));
    expect((finished[0]!.parsed as { intensity: number }).intensity).toBe(9);
    expect((finished[0]!.normalized as { intensity: number }).intensity).toBe(5);
  }, 60_000);

  it('lists what the model reported and what the engine adds from the prompt', async () => {
    const { service } = setup(JSON.stringify(briefOf({ unsupported: ['Chưa có boss'] })));
    const project = await ask(service, 'có boss, nâng cấp và xây tháp quanh căn cứ');
    expect(project.notices).toEqual([
      'Chưa có boss',
      'Chưa hỗ trợ: xây hoặc nâng cấp tháp, tường. Căn cứ không thể xây thêm.',
      'Chưa hỗ trợ: vật phẩm tăng sức mạnh và nâng cấp. Chỉ có vật phẩm hồi máu.',
    ]);
    expect(ShooterProjectSchema.safeParse(project).success).toBe(true);
  }, 60_000);

  it('the demo is the hand-made arena', () => {
    const { service } = setup('{}');
    const project: ShooterProject = service.demo('bất kỳ');
    expect(project).toMatchObject({ provider: 'demo', modelId: 'shooter-arena', notices: [], title: SHOOTER_LEVELS.arena.title, prompt: 'bất kỳ' });
    expect(project.level).toEqual(SHOOTER_LEVELS.arena);
    expect(ShooterProjectSchema.safeParse(project).success).toBe(true);
  });
});

describe('a brief that cannot be used', () => {
  const SECRET = 'MODEL-TEXT-THAT-MUST-NOT-LEAK';

  it('not JSON -> invalid_brief 422, and the model text is not echoed', async () => {
    const { service, seen, finished } = setup(`Xin lỗi ${SECRET}`);
    const error = await failure(ask(service));
    expect(error).toBeInstanceOf(AIError);
    expect(error).toMatchObject({ code: 'invalid_brief', status: 422, message: NOT_JSON_MESSAGE });
    expect(error!.message).not.toContain(SECRET);
    expect(seen).toHaveLength(1); // no retry
    expect(finished[0]).toMatchObject({ outcome: 'failed', stage: 'parse', errorCode: 'invalid_brief' });
  });

  it.each([
    ['a wrong theme', { theme: SECRET }, 'theme', 'Mô hình chọn một giá trị không hỗ trợ cho theme.'],
    ['a wrong map', { map: SECRET }, 'map', 'Mô hình chọn một giá trị không hỗ trợ cho map.'],
    ['a wrong weapon', { weapon: SECRET }, 'weapon', 'Mô hình chọn một giá trị không hỗ trợ cho weapon.'],
    ['a wrong playerHealth', { playerHealth: SECRET }, 'playerHealth', 'Mô hình chọn một giá trị không hỗ trợ cho playerHealth.'],
    ['a wrong enemy', { enemies: [{ type: SECRET, share: 3 }] }, 'enemies.0.type', 'Danh sách quái không hợp lệ.'],
    ['no enemies', { enemies: [] }, 'enemies', 'Danh sách quái không hợp lệ.'],
    ['a wrong goal', { goal: { type: SECRET, seconds: 60 } }, 'goal.type', 'Mục tiêu không hợp lệ.'],
    ['a title with markup', { title: `<b>${SECRET}</b>` }, 'title', 'Bản mô tả game không đúng khuôn dạng.'],
    ['an unknown field', { [SECRET]: 1 }, '', 'Bản mô tả game không đúng khuôn dạng.'],
    ['a wrong version', { version: SECRET }, 'version', 'Bản mô tả game không đúng khuôn dạng.'],
  ])('%s -> invalid_brief with the right reason, and nothing of the model text', async (_name, patch, path, reason) => {
    const { service, seen, finished } = setup(JSON.stringify(briefOf(patch)));
    const error = await failure(ask(service, `prompt ${SECRET}`));
    expect(error).toBeInstanceOf(AIError);
    expect(error).toMatchObject({ code: 'invalid_brief', status: 422, issues: [path] });
    expect(error!.message).toBe(`${INVALID_BRIEF_MESSAGE} Lý do: ${reason}`);
    expect(JSON.stringify({ message: error!.message, issues: error!.issues, details: error!.details })).not.toContain(SECRET);
    expect(seen).toHaveLength(1);
    expect(finished[0]).toMatchObject({ outcome: 'failed', stage: 'schema', validation: { schema: 'ShooterBriefSchema', success: false } });
  });

  it('a missing field is reported by its name; JSON that is not an object has no reason beyond the generic one', async () => {
    const { theme: _theme, ...without } = briefOf();
    const missing = await failure(ask(setup(JSON.stringify(without)).service));
    expect(missing).toMatchObject({ code: 'invalid_brief', issues: ['theme'] });
    expect(missing!.message).toContain('cho theme.');
    const array = await failure(ask(setup('[1,2,3]').service));
    expect(array).toMatchObject({ code: 'invalid_brief', issues: [''] });
    expect(array!.message).toBe(`${INVALID_BRIEF_MESSAGE} Lý do: Bản mô tả game không đúng khuôn dạng.`);
  });

  it('an answer that is far too long is not even parsed', async () => {
    const error = await failure(ask(setup(JSON.stringify({ ...briefOf(), padding: 'x'.repeat(20_000) })).service));
    expect(error).toMatchObject({ code: 'invalid_brief', status: 422, message: INVALID_BRIEF_MESSAGE });
  });

  it('briefReason is a fixed table', () => {
    expect(briefReason('theme')).toBe('Mô hình chọn một giá trị không hỗ trợ cho theme.');
    expect(briefReason('enemies.2.share')).toBe('Danh sách quái không hợp lệ.');
    expect(briefReason('goal.seconds')).toBe('Mục tiêu không hợp lệ.');
    expect(briefReason(undefined)).toBe('Bản mô tả game không đúng khuôn dạng.');
    expect(briefReason('__proto__.x')).toBe('Bản mô tả game không đúng khuôn dạng.');
  });
});

describe('failures after the brief is accepted', () => {
  it('a client abort stops the compile worker and answers 499', async () => {
    const controller = new AbortController();
    let worker: Worker | undefined;
    const { service } = setup(JSON.stringify(briefOf()), {
      compile: (job, signal) => compileInWorker(job, signal, { timeoutMs: WIDE, onWorker: (w) => { worker = w; setTimeout(() => controller.abort(), 20); } }),
    });
    const exited = new Promise<void>((resolve) => { const poll = () => (worker ? worker.once('exit', () => resolve()) : setTimeout(poll, 5)); poll(); });
    const error = await failure(ask(service, 'zombie', controller.signal));
    expect(error).toMatchObject({ code: 'cancelled', status: 499 });
    await exited;
    expect(worker!.threadId).toBe(-1);
  }, 60_000);

  it('a client that is gone before the call never reaches the provider', async () => {
    const controller = new AbortController();
    controller.abort();
    const { service, seen } = setup(JSON.stringify(briefOf()));
    const error = await failure(ask(service, 'zombie', controller.signal));
    expect(error).toMatchObject({ code: 'cancelled', status: 499 });
    expect(seen).toHaveLength(0);
  });

  it('compile past the time limit -> compile_timeout 422 at path "compile", worker terminated', async () => {
    let worker: Worker | undefined;
    const { service, finished } = setup(JSON.stringify(briefOf()), {
      compile: (job, signal) => compileInWorker(job, signal, { timeoutMs: 1, onWorker: (w) => { worker = w; } }),
    });
    const error = await failure(ask(service));
    expect(error).toMatchObject({ code: 'compile_timeout', status: 422, issues: ['compile'], message: COMPILE_TIMEOUT_MESSAGE });
    expect(error!.message).toBe('Dựng màn chơi quá lâu. Hãy đơn giản hóa mô tả.');
    expect(worker!.threadId).toBe(-1);
    expect(finished[0]).toMatchObject({ outcome: 'failed', stage: 'repair', errorCode: 'compile_timeout' });
  });

  it('an unwinnable level from the compile step keeps its code and path', async () => {
    const { service } = setup(JSON.stringify(briefOf()), {
      compile: async () => { throw new AIError('unwinnable_level', 'Không dựng được màn chơi thắng được với yêu cầu này. Hãy giảm độ khó hoặc đổi vũ khí/số máu.', 422, undefined, ['goal']); },
    });
    expect(await failure(ask(service))).toMatchObject({ code: 'unwinnable_level', status: 422, issues: ['goal'] });
  });

  it('a provider error passes through and the provider is not called twice', async () => {
    const { service, seen } = setup(async () => { throw new AIError('rate_limit', 'Provider đã hết quota. Hãy thử lại sau.', 429, 60); });
    const error = await failure(ask(service));
    expect(error).toMatchObject({ code: 'rate_limit', status: 429, retryAfterSeconds: 60 });
    expect(seen).toHaveLength(1);
  });
});

describe('POST /api/shooter/generate', () => {
  const app = (answer: string) => {
    const { service, generation } = setup(answer);
    return createApp({ gateway: generation, shooterService: service });
  };
  const post = (server: ReturnType<typeof createApp>, body: unknown) => request(server).post('/api/shooter/generate').send(body as object);

  it('201 with the shooter project shape', async () => {
    const response = await post(app(JSON.stringify(briefOf())), { providerId: 'groq', prompt: 'zombie' }).expect(201);
    expect(GenerateShooterResponseSchema.safeParse(response.body).success).toBe(true);
    expect(ShooterLevelSchema.safeParse(response.body.data.level).success).toBe(true);
    expect(response.body.data).toMatchObject({ provider: 'groq', notices: [] });
  }, 60_000);

  it('works with the other provider and a chosen model', async () => {
    const provider = mockProvider('gemini', async () => JSON.stringify(briefOf()));
    const generation = new AiGateway(mockRegistry([provider]), new RequestBudget({ requestsPerMinute: 1000, requestsPerDay: 10000 }));
    const shooterService = new ShooterService(generation, { compile: wide, seed: () => 1 });
    const server = createApp({ gateway: generation, shooterService });
    const response = await post(server, { providerId: 'gemini', modelId: 'gemini-3.5-flash-lite', prompt: 'zombie' }).expect(201);
    expect(response.body.data).toMatchObject({ provider: 'gemini', modelId: 'gemini-3.5-flash-lite' });
  }, 60_000);

  it('400 for an empty prompt and for one over 2000 characters', async () => {
    const server = app('{}');
    expect((await post(server, { providerId: 'groq', prompt: '   ' }).expect(400)).body.error.code).toBe('INVALID_PROMPT');
    const long = await post(server, { providerId: 'groq', prompt: 'x'.repeat(2001) }).expect(400);
    expect(long.body.error.code).toBe('INVALID_PROMPT');
    await post(server, {}).expect(400);
  });

  it('the demo answers without a provider', async () => {
    const server = app('{}');
    for (const body of [{ prompt: 'zombie' }, { providerId: 'demo', modelId: 'shooter-arena', prompt: 'zombie' }]) {
      const response = await post(server, body).expect(201);
      expect(response.body.data).toMatchObject({ provider: 'demo', modelId: 'shooter-arena', notices: [] });
      expect(GenerateShooterResponseSchema.safeParse(response.body).success).toBe(true);
    }
    expect((await post(server, { providerId: 'demo', prompt: 'x' }).expect(400)).body.error.code).toBe('invalid_model');
  });

  it('a bad brief is 422 with the reason and the paths, like the other generators', async () => {
    const response = await post(app(JSON.stringify(briefOf({ theme: 'pirate-cove' }))), { providerId: 'groq', prompt: 'x' }).expect(422);
    expect(response.body.error).toMatchObject({ code: 'invalid_brief' });
    expect(response.body.error.message).toContain('Lý do: Mô hình chọn một giá trị không hỗ trợ cho theme.');
    expect(JSON.stringify(response.body)).not.toContain('pirate-cove');
  });

  it('an unknown provider is 400 and a missing key is 503', async () => {
    const server = app('{}');
    expect((await post(server, { providerId: 'nope', modelId: 'x', prompt: 'x' }).expect(400)).body.error.code).toBe('invalid_provider');
  });
});
