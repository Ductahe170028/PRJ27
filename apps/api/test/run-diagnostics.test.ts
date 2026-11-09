import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentRequest } from '@game-creator/contracts';
import { AgentOrchestrator } from '../src/agent/orchestrator.js';
import { CodeValidator } from '../src/agent/code-validator.js';
import { FileRunDiagnostics, allocateRun, diagnosticsEnabled, openRunDiagnostics } from '../src/agent/run-diagnostics.js';
import { GameGenerationService } from '../src/services/game-generation-service.js';
import { RequestBudget } from '../src/services/request-budget.js';
import { StructuredOutputError } from '../src/providers/errors.js';
import { buildGroqExchange } from '../src/providers/groq-exchange.js';
import { mockProvider, mockRegistry } from './fixtures.js';
import { shooterPlan, shooterSource } from './agent-fixtures.js';

const planText = JSON.stringify(shooterPlan);
const code = (source: string) => JSON.stringify({ source });
const broken = 'function create(api: GameAPI): void { const gap = gap; }\nfunction update(api: GameAPI, dt: number): void {}';
const timerSource = 'function create(api: GameAPI): void { api.state.pipeTimer = 0; }\nfunction update(api: GameAPI, dt: number): void { api.state.pipeTimer += dt; }';

async function tempRoot(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'advanced-diag-'));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
}

async function treeText(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    chunks.push(entry.isDirectory() ? await treeText(full) : await readFile(full, 'utf8'));
  }
  return chunks.join('\n');
}

function harness(root: string, outputs: Array<string | Error>, testErrors: string[][] = [[]], prompt = 'Tạo máy bay có đạn và boss') {
  const request: AgentRequest = { providerId: 'groq', prompt };
  const generate = vi.fn(async () => {
    const next = outputs.shift();
    if (next instanceof Error) throw next;
    return next ?? '';
  });
  const service = new GameGenerationService(mockRegistry([mockProvider('groq', generate)]), new RequestBudget({ requestsPerMinute: 100 }));
  const test = vi.fn(async () => ({ errors: testErrors.shift() ?? [] }));
  const runs: FileRunDiagnostics[] = [];
  const agent = new AgentOrchestrator(service, { test }, new CodeValidator(), async (reserved) => {
    const run = await FileRunDiagnostics.create(reserved, root);
    runs.push(run);
    return run;
  });
  const events: AgentEvent[] = [];
  return { generate, test, events, runs, run: async () => {
    const reservation = agent.reserve(request);
    try { await agent.run(reservation.request, 'test', new AbortController().signal, (event) => events.push(event)); }
    finally { reservation.release(); }
    return runs[0]!;
  } };
}

describe('per-run advanced diagnostics', () => {
  it('gives every run its own id and keeps legacy files', async () => {
    const { root, cleanup } = await tempRoot();
    try {
      expect(diagnosticsEnabled()).toBe(false);
      expect((await openRunDiagnostics({ providerId: 'groq', prompt: 'x' })).directory).toBe('');
      const allocated = await Promise.all(Array.from({ length: 8 }, () => allocateRun(root, new Date('2026-11-09T13:45:00Z'))));
      expect(new Set(allocated.map((item) => item.runId)).size).toBe(8);
      expect(allocated[0]!.runId).toMatch(/^advanced-\d{8}-\d{6}-[0-9a-f]{4}$/);
      const legacy = 'legacy flappy source\n';
      await writeFile(path.join(root, 'groq-flappy-game.ts'), legacy);
      await writeFile(path.join(root, 'groq-flappy-errors.json'), '{"result":"old"}\n');
      const first = harness(root, [planText, code(shooterSource)]);
      const second = harness(root, [planText, code(shooterSource)], [[]], 'PROMPT-BETA-UNIQUE');
      const [left, right] = await Promise.all([first.run(), second.run()]);
      expect(left.runId).not.toBe(right.runId);
      expect(left.directory).not.toBe(right.directory);
      const leftRequest = await readFile(path.join(left.directory, 'planning', 'request.json'), 'utf8');
      const rightRequest = await readFile(path.join(right.directory, 'planning', 'request.json'), 'utf8');
      expect(leftRequest).toContain('Tạo máy bay có đạn và boss');
      expect(leftRequest).not.toContain('PROMPT-BETA-UNIQUE');
      expect(rightRequest).toContain('PROMPT-BETA-UNIQUE');
      expect(rightRequest).not.toContain('Tạo máy bay có đạn và boss');
      expect(await readFile(path.join(root, 'groq-flappy-game.ts'), 'utf8')).toBe(legacy);
      expect(await readFile(path.join(root, 'groq-flappy-errors.json'), 'utf8')).toBe('{"result":"old"}\n');
    } finally { await cleanup(); }
  });

  it('saves a Planning HTTP 400 with empty content and still writes the manifest', async () => {
    const exchange = buildGroqExchange({
      provider: 'groq', model: 'openai/gpt-oss-20b', httpStatus: 400, usage: null,
      responseFormat: { type: 'json_schema', json_schema: { name: 'game_spec_v1', strict: true, schema: { type: 'object', properties: { title: { type: 'string' } } } } },
      cause: { status: 400, error: { message: 'ignored upstream text', code: 'json_validate_failed' } },
      fallbackMessage: 'Groq từ chối JSON Schema trước khi trả nội dung (json_validate_failed). Không có failed_generation.',
      fallbackCode: 'invalid_code',
    });
    expect(exchange).toMatchObject({ httpStatus: 400, contentPresent: false, failedGenerationPresent: false, errorCode: 'json_validate_failed' });
    expect(exchange.rawContent).toBeUndefined();
    expect(JSON.stringify(exchange)).not.toContain('ignored upstream');
    expect(exchange.responseFormat).toMatchObject({ type: 'json_schema' });

    const { root, cleanup } = await tempRoot();
    try {
      const noted = await FileRunDiagnostics.create({ providerId: 'groq', modelId: 'openai/gpt-oss-20b', prompt: 'flappy' }, root);
      await noted.planningRequest({ provider: 'groq', model: 'openai/gpt-oss-20b', prompt: 'flappy', maxOutputTokens: 450 });
      await noted.note(exchange);
      const saved = await readJson(path.join(noted.directory, 'planning', 'error.json'));
      expect(saved.httpStatus).toBe(400);
      expect(saved.contentPresent).toBe(false);
      expect(saved.rawContent).toBeUndefined();
      expect(await readFile(path.join(noted.directory, 'planning', 'request.json'), 'utf8')).toContain('flappy');

      const failure = new StructuredOutputError('Groq từ chối JSON Schema trước khi trả nội dung (json_validate_failed). Không có failed_generation.', undefined, '/properties/title', 400);
      const h = harness(root, [failure]);
      const run = await h.run();
      const error = await readJson(path.join(run.directory, 'planning', 'error.json'));
      expect(error.httpStatus).toBe(400);
      expect(error.contentPresent).toBe(false);
      expect(error.schemaPath).toBe('/properties/title');
      expect(await readJson(path.join(run.directory, 'manifest.json'))).toMatchObject({ runId: run.runId });
      expect(await readdir(run.directory)).not.toContain('coding');
      expect(await readJson(path.join(run.directory, 'final-summary.json'))).toMatchObject({ outcome: 'failed', failedStage: 'Planning', previewReady: false, repairs: 0 });
      expect(h.generate).toHaveBeenCalledOnce();
    } finally { await cleanup(); }
  });

  it('keeps the Planning output when Coding fails', async () => {
    const { root, cleanup } = await tempRoot();
    try {
      const h = harness(root, [planText, Object.assign(new Error('secret upstream'), { status: 401 })]);
      const run = await h.run();
      expect(await readFile(path.join(run.directory, 'planning', 'response.json'), 'utf8')).toContain('Sky Defender');
      const error = await readFile(path.join(run.directory, 'coding', 'error.json'), 'utf8');
      expect(error).toContain('provider_error');
      expect(error).not.toContain('secret upstream');
      expect(await readdir(run.directory)).not.toContain('repair-1');
      expect(h.generate).toHaveBeenCalledTimes(2);
    } finally { await cleanup(); }
  });

  it('stores Repair 1 and Repair 2 as separate snapshots', async () => {
    const { root, cleanup } = await tempRoot();
    try {
      const h = harness(root, [planText, code(broken), code(broken), code(broken)]);
      const run = await h.run();
      for (const folder of ['repair-1', 'repair-2']) {
        expect(await readFile(path.join(run.directory, folder, 'input-source.ts'), 'utf8')).toContain('const gap = gap');
        expect(await readFile(path.join(run.directory, folder, 'raw-output.json'), 'utf8')).toContain('const gap = gap');
        expect(await readFile(path.join(run.directory, folder, 'source.ts'), 'utf8')).toContain('const gap = gap');
        const recorded = await readJson(path.join(run.directory, folder, 'errors.json'));
        expect(recorded.progress).toBe('repair_no_progress');
        expect(recorded.fingerprintBefore).toBe(recorded.fingerprintAfter);
        expect(String(recorded.errors)).toContain('gap');
        expect(String(recorded.errors)).not.toContain('repair_no_progress');
        const request = await readJson(path.join(run.directory, folder, 'request.json'));
        expect(request.fingerprintBefore).toBe(recorded.fingerprintBefore);
        expect(String(request.diagnostics)).toContain('gap');
      }
      const secondRequest = await readJson(path.join(run.directory, 'repair-2', 'request.json'));
      expect(String(secondRequest.diagnostics)).toContain('repair_no_progress');
      expect(await readFile(path.join(run.directory, 'coding', 'source.ts'), 'utf8')).toContain('const gap = gap');
      expect(await readJson(path.join(run.directory, 'coding', 'errors.json'))).toMatchObject({ progress: 'validation_errors' });
      expect(h.generate).toHaveBeenCalledTimes(4);
    } finally { await cleanup(); }
  });

  it('keeps the pre-normalization source distinct from the normalized source', async () => {
    const { root, cleanup } = await tempRoot();
    try {
      const h = harness(root, [planText, code(timerSource)]);
      const run = await h.run();
      const before = await readFile(path.join(run.directory, 'coding', 'source.ts'), 'utf8');
      const after = await readFile(path.join(run.directory, 'coding', 'normalized-source.ts'), 'utf8');
      expect(before).toContain('pipeTimer += dt');
      expect(after).toContain('??');
      expect(after).not.toBe(before);
      expect(h.events.at(-1)).toMatchObject({ type: 'completed', project: { repairs: 0 } });
    } finally { await cleanup(); }
  });

  it('keeps the last source when Playwright reports a gameplay failure', async () => {
    const gameplay = 'Projectile: no continuous forward flight after action release.';
    const { root, cleanup } = await tempRoot();
    try {
      const h = harness(root, [planText, code(shooterSource), code(shooterSource), code(shooterSource)], [[gameplay], [gameplay], [gameplay]]);
      const run = await h.run();
      expect(await readFile(path.join(run.directory, 'coding', 'normalized-source.ts'), 'utf8')).toContain('function create');
      expect(await readFile(path.join(run.directory, 'repair-2', 'normalized-source.ts'), 'utf8')).toContain('e.y -= 480 * dt');
      const tested = await readJson(path.join(run.directory, 'testing', 'result.json'));
      expect(tested.errors).toContain(gameplay);
      expect(tested.source).toBe('repair-2/normalized-source.ts');
      expect(await readFile(path.join(run.directory, 'testing', 'attempt-0.json'), 'utf8')).toContain(gameplay);
      expect(await readJson(path.join(run.directory, 'final-summary.json'))).toMatchObject({
        outcome: 'failed', failedStage: 'Testing', errorCode: 'agent_failed', repairs: 2, previewReady: false,
      });
      expect(h.test).toHaveBeenCalledTimes(3);
    } finally { await cleanup(); }
  });

  it('does not write an API key or an Authorization header', async () => {
    const { root, cleanup } = await tempRoot();
    try {
      const run = await FileRunDiagnostics.create({ providerId: 'groq', modelId: 'openai/gpt-oss-20b', prompt: 'gap' }, root);
      await run.note({
        provider: 'groq', model: 'openai/gpt-oss-20b', httpStatus: 400, contentPresent: true, usage: null,
        errorMessage: 'Authorization: Bearer sk-abcdef token',
        rawContent: 'gsk_supersecretkey',
        responseFormat: { authorization: 'Bearer sk-abcdef', apiKey: 'gsk_supersecretkey', headers: { Authorization: 'Bearer hidden-header' }, schema: { type: 'object' } },
      });
      await run.checkedSource(0, { before: 'const gap = api.state.gap ?? 0;', after: 'const gap = api.state.gap ?? 0;', errors: [] });
      const text = await treeText(run.directory);
      expect(text).toContain('api.state.gap');
      expect(text).not.toContain('gsk_');
      expect(text).not.toContain('sk-');
      expect(text).not.toContain('Bearer');
      expect(text).not.toContain('hidden-header');
      expect(text.toLowerCase()).not.toContain('authorization');
    } finally { await cleanup(); }
  });

  it('does not change the pipeline result when diagnostics cannot be written', async () => {
    const { root, cleanup } = await tempRoot();
    try {
      const failing = { writeFile: async () => { throw new Error('EIO disk'); } };
      const generate = vi.fn(async () => {
        const next = [planText, code(shooterSource)][generate.mock.calls.length - 1];
        return next ?? '';
      });
      const service = new GameGenerationService(mockRegistry([mockProvider('groq', generate)]), new RequestBudget({ requestsPerMinute: 100 }));
      const test = vi.fn(async () => ({ errors: [] as string[] }));
      const agent = new AgentOrchestrator(service, { test }, new CodeValidator(), (request) => FileRunDiagnostics.create(request, root, failing));
      const events: AgentEvent[] = [];
      const reservation = agent.reserve({ providerId: 'groq', prompt: 'Tạo máy bay có đạn và boss' });
      try { await agent.run(reservation.request, 'test', new AbortController().signal, (event) => events.push(event)); }
      finally { reservation.release(); }
      expect(events.at(-1)).toMatchObject({ type: 'completed', project: { repairs: 0 } });
      expect(generate).toHaveBeenCalledTimes(2);
      expect(test).toHaveBeenCalledOnce();
      expect(JSON.stringify(events)).not.toContain('EIO');

      const blocked = path.join(root, 'not-a-directory');
      await writeFile(blocked, 'legacy');
      const generateAgain = vi.fn(async () => [planText, code(shooterSource)][generateAgain.mock.calls.length - 1] ?? '');
      const again = new GameGenerationService(mockRegistry([mockProvider('groq', generateAgain)]), new RequestBudget({ requestsPerMinute: 100 }));
      const testAgain = vi.fn(async () => ({ errors: [] as string[] }));
      const blockedAgent = new AgentOrchestrator(again, { test: testAgain }, new CodeValidator(), (request) => FileRunDiagnostics.create(request, blocked));
      const blockedEvents: AgentEvent[] = [];
      const second = blockedAgent.reserve({ providerId: 'groq', prompt: 'Tạo máy bay có đạn và boss' });
      try { await blockedAgent.run(second.request, 'test', new AbortController().signal, (event) => blockedEvents.push(event)); }
      finally { second.release(); }
      expect(blockedEvents.at(-1)).toMatchObject({ type: 'completed', project: { repairs: 0 } });
      expect(generateAgain).toHaveBeenCalledTimes(2);
      expect(await readFile(blocked, 'utf8')).toBe('legacy');
      expect(JSON.stringify(blockedEvents)).not.toContain('legacy');
    } finally { await cleanup(); }
  });
});
