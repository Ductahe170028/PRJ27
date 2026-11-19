import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileRunDiagnostics } from '../src/agent/run-diagnostics.js';
import { diagnosticSink } from '../src/providers/diagnostic-sink.js';
import { StructuredOutputError } from '../src/providers/errors.js';
import { buildGroqExchange } from '../src/providers/groq-exchange.js';
import { GameGenerationService } from '../src/services/game-generation-service.js';
import { RequestBudget } from '../src/services/request-budget.js';
import { StandardRun, standardDiagnosticsEnabled } from '../src/services/standard-diagnostics.js';
import { mockProvider, mockRegistry, sampleSpec } from './fixtures.js';

const saved = {
  NODE_ENV: process.env.NODE_ENV,
  STANDARD_DIAGNOSTICS: process.env.STANDARD_DIAGNOSTICS,
  STANDARD_DIAGNOSTICS_DIR: process.env.STANDARD_DIAGNOSTICS_DIR,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
};

afterEach(() => {
  restore('NODE_ENV', saved.NODE_ENV);
  restore('STANDARD_DIAGNOSTICS', saved.STANDARD_DIAGNOSTICS);
  restore('STANDARD_DIAGNOSTICS_DIR', saved.STANDARD_DIAGNOSTICS_DIR);
  restore('GROQ_API_KEY', saved.GROQ_API_KEY);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function tempRoot(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'standard-diag-'));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
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

const selection = { providerId: 'groq' as const, modelId: 'openai/gpt-oss-20b' };
const signal = () => new AbortController().signal;

describe('standard mode diagnostics', () => {
  it('stays off in test and production, and a failed open does not change a successful game', async () => {
    expect(standardDiagnosticsEnabled()).toBe(false);
    const { root, cleanup } = await tempRoot();
    try {
      process.env.STANDARD_DIAGNOSTICS_DIR = root;
      const service = new GameGenerationService(mockRegistry([mockProvider('groq', async () => JSON.stringify(sampleSpec()))]));
      const project = await service.generate({ ...selection, prompt: 'ninja' }, 'test', signal());
      expect(project.game.title).toBe('Ninja Moon');
      expect(await readdir(root)).toEqual([]);

      process.env.NODE_ENV = 'production';
      process.env.STANDARD_DIAGNOSTICS = '1';
      expect(standardDiagnosticsEnabled()).toBe(false);
      process.env.NODE_ENV = 'development';
      process.env.STANDARD_DIAGNOSTICS = '0';
      expect(standardDiagnosticsEnabled()).toBe(false);
    } finally { await cleanup(); }
  });

  it('stores the invalid spec, full issues and sent prompt without secrets', async () => {
    const { root, cleanup } = await tempRoot();
    const prompt = `maze gsk_promptsecretvalue ${'x'.repeat(10)}`;
    const previousKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = 'gsk_envonlysecretvalue';
    process.env.STANDARD_DIAGNOSTICS = '1';
    process.env.STANDARD_DIAGNOSTICS_DIR = root;
    const game = sampleSpec('top-down');
    game.title = 'SHADOW <maze>';
    game.player.jumpSpeed = 1;
    const raw = JSON.stringify({ ...game, leak: 'gsk_outputsecretvalue' });
    const prompts: string[] = [];
    const service = new GameGenerationService(mockRegistry([mockProvider('groq', async (input) => {
      prompts.push(input.prompt);
      return raw;
    })]));
    try {
      await expect(service.generate({ ...selection, prompt }, 'test', signal())).rejects.toMatchObject({
        code: 'invalid_game_spec',
        details: expect.arrayContaining([expect.objectContaining({ path: 'title', code: expect.any(String), message: expect.any(String) })]),
      });
      const runs = (await readdir(root)).filter((name) => name.startsWith('standard-'));
      expect(runs).toHaveLength(1);
      const directory = path.join(root, runs[0]!);
      const request = JSON.parse(await readFile(path.join(directory, 'request.json'), 'utf8')) as {
        runId: string; prompt: string; promptLength: number; provider: string; model: string;
      };
      const parsed = JSON.parse(await readFile(path.join(directory, 'parsed.json'), 'utf8')) as { title: string; player: { jumpSpeed: number } };
      const normalized = JSON.parse(await readFile(path.join(directory, 'normalized.json'), 'utf8')) as { title: string; player: { jumpSpeed: number } };
      const validation = JSON.parse(await readFile(path.join(directory, 'validation.json'), 'utf8')) as {
        success: boolean; issues: Array<{ path: string; code: string; message: string }>;
      };
      const summary = JSON.parse(await readFile(path.join(directory, 'summary.json'), 'utf8')) as {
        runId: string; stage: string; outcome: string; errorCode: string; issues: Array<{ path: string }>;
      };
      expect(request).toMatchObject({
        runId: runs[0], promptLength: prompt.length, provider: 'groq', model: 'openai/gpt-oss-20b',
      });
      expect(prompts).toEqual([prompt]);
      expect(parsed.title).toBe('SHADOW <maze>');
      expect(parsed.player.jumpSpeed).toBe(1);
      expect(normalized.title).toBe('SHADOW <maze>');
      expect(normalized.player.jumpSpeed).toBe(350);
      expect(validation).toMatchObject({ status: 'checked', success: false });
      expect(validation.issues.some((issue) => issue.path === 'title' && issue.code && issue.message)).toBe(true);
      expect(summary).toMatchObject({ runId: runs[0], stage: 'schema', outcome: 'failed', reason: 'game_spec', errorCode: 'invalid_game_spec' });
      expect(summary.issues.some((issue) => issue.path === 'title')).toBe(true);
      const stored = await treeText(directory);
      expect(stored).not.toContain('gsk_promptsecretvalue');
      expect(stored).not.toContain('gsk_outputsecretvalue');
      expect(stored).not.toContain('gsk_envonlysecretvalue');
      expect(previousKey ? stored.includes(previousKey) : false).toBe(false);
      expect(await readFile(path.join(directory, 'provider-output.txt'), 'utf8')).not.toContain('gsk_outputsecretvalue');
    } finally { await cleanup(); }
  });

  it('records a completed run without changing the game', async () => {
    const { root, cleanup } = await tempRoot();
    process.env.STANDARD_DIAGNOSTICS = '1';
    process.env.STANDARD_DIAGNOSTICS_DIR = root;
    try {
      const service = new GameGenerationService(mockRegistry([mockProvider('groq', async () => JSON.stringify(sampleSpec()))]));
      const project = await service.generate({ ...selection, prompt: 'ninja maze' }, 'test', signal());
      expect(project.game.title).toBe('Ninja Moon');
      const runs = await readdir(root);
      expect(runs).toHaveLength(1);
      const summary = JSON.parse(await readFile(path.join(root, runs[0]!, 'summary.json'), 'utf8')) as { stage: string; outcome: string };
      const validation = JSON.parse(await readFile(path.join(root, runs[0]!, 'validation.json'), 'utf8')) as { success: boolean };
      expect(summary).toMatchObject({ stage: 'response', outcome: 'completed', reason: 'completed' });
      expect(validation).toMatchObject({ status: 'checked', success: true });
    } finally { await cleanup(); }
  });

  it('ignores a diagnostics write failure and a directory that cannot be created', async () => {
    const { root, cleanup } = await tempRoot();
    try {
      const run = new StandardRun('standard-test', root, { writeFile: async () => { throw new Error('disk full'); } });
      await expect(run.note({
        provider: 'groq', model: 'openai/gpt-oss-20b', contentPresent: true, failedGenerationPresent: true,
        rawContent: 'gsk_outputsecretvalue', usage: null, httpStatus: 400, errorCode: 'json_validate_failed', schemaPath: '/properties/title',
      })).resolves.toBeUndefined();
      await expect(run.raw('gsk_outputsecretvalue')).resolves.toBeUndefined();
      await expect(run.finish({
        stage: 'schema', outcome: 'failed', raw: 'gsk_outputsecretvalue', parsed: { title: 'SHADOW <maze>' }, normalized: null,
        validation: { status: 'checked', schema: 'GameSpecPlacementInputSchema', success: false, issues: [{ path: 'title', code: 'invalid_format', message: 'Invalid string' }] },
        issues: [{ path: 'title', code: 'invalid_format', message: 'Invalid string' }],
        errorCode: 'invalid_game_spec', errorMessage: 'bad',
      })).resolves.toBeUndefined();

      const disk = {
        note: vi.fn(async () => { throw new Error('disk full'); }),
        raw: vi.fn(async () => { throw new Error('disk full'); }),
        finish: vi.fn(async () => { throw new Error('disk full'); }),
      };
      const throwing = new GameGenerationService(
        mockRegistry([mockProvider('groq', async () => JSON.stringify(sampleSpec()))]),
        new RequestBudget(), 45_000, async () => disk,
      );
      await expect(throwing.generate({ ...selection, prompt: 'ninja' }, 'test', signal())).resolves.toMatchObject({
        game: { title: 'Ninja Moon' },
      });
      expect(disk.finish).toHaveBeenCalledOnce();

      const invalid = new GameGenerationService(
        mockRegistry([mockProvider('groq', async () => 'not json')]),
        new RequestBudget(), 45_000, async () => ({
          note: async () => { throw new Error('disk full'); },
          raw: async () => { throw new Error('disk full'); },
          finish: async () => { throw new Error('disk full'); },
        }),
      );
      await expect(invalid.generate({ ...selection, prompt: 'ninja' }, 'test', signal())).rejects.toMatchObject({
        code: 'invalid_game_spec', message: expect.stringContaining('JSON'),
      });

      const blocked = path.join(root, 'not-a-directory');
      await writeFile(blocked, 'x');
      process.env.STANDARD_DIAGNOSTICS = '1';
      process.env.STANDARD_DIAGNOSTICS_DIR = blocked;
      const opened = new GameGenerationService(mockRegistry([mockProvider('groq', async () => JSON.stringify(sampleSpec()))]));
      await expect(opened.generate({ ...selection, prompt: 'ninja' }, 'test', signal())).resolves.toMatchObject({
        game: { title: 'Ninja Moon' },
      });
    } finally { await cleanup(); }
  });

  it('keeps standard and advanced diagnostics in separate runs', async () => {
    const standard = await tempRoot();
    const advanced = await tempRoot();
    process.env.STANDARD_DIAGNOSTICS = '1';
    process.env.STANDARD_DIAGNOSTICS_DIR = standard.root;
    const exchange = (title: string, schemaPath?: string) => buildGroqExchange({
      provider: 'groq', model: 'openai/gpt-oss-20b',
      responseFormat: { type: 'json_schema', json_schema: { name: 'game_spec_v1', strict: true, schema: { type: 'object' } } },
      httpStatus: 400,
      cause: { status: 400, error: { code: 'json_validate_failed', failed_generation: `{"title":"${title}"}`, ...(schemaPath ? { schema_path: schemaPath } : {}) } },
      fallbackMessage: 'Groq trả JSON do model sinh không khớp schema (json_validate_failed).',
      fallbackCode: 'invalid_code',
    });
    try {
      const standardRun = await StandardRun.create({ prompt: 'standard prompt', provider: 'groq', model: 'openai/gpt-oss-20b' }, standard.root);
      const advancedRun = await FileRunDiagnostics.create({ providerId: 'groq', modelId: 'openai/gpt-oss-20b', prompt: 'advanced prompt' }, advanced.root);
      await standardRun.note(exchange('STANDARD-ONLY', '/properties/title'));
      await advancedRun.note(exchange('ADVANCED-ONLY'));
      await advancedRun.planningRequest({ provider: 'groq', model: 'openai/gpt-oss-20b', prompt: 'ADVANCED-PROMPT-ONLY', maxOutputTokens: 450 });
      const provider = mockProvider('groq', async () => {
        await diagnosticSink.getStore()?.note(exchange('FROM-STANDARD', '/properties/title'));
        throw new StructuredOutputError('Groq trả JSON do model sinh không khớp schema (json_validate_failed).', '{"title":"FROM-STANDARD"}', '/properties/title', 400);
      });
      await diagnosticSink.run(advancedRun, async () => {
        await expect(new GameGenerationService(mockRegistry([provider])).generate({ ...selection, prompt: 'shadow maze' }, 'test', signal()))
          .rejects.toMatchObject({ code: 'invalid_code' });
      });
      const standardText = await treeText(standard.root);
      const advancedText = await treeText(advanced.root);
      expect(standardText).toContain('STANDARD-ONLY');
      expect(standardText).toContain('FROM-STANDARD');
      expect(standardText).not.toContain('ADVANCED-ONLY');
      expect(standardText).not.toContain('ADVANCED-PROMPT-ONLY');
      expect(advancedText).toContain('ADVANCED-ONLY');
      expect(advancedText).toContain('ADVANCED-PROMPT-ONLY');
      expect(advancedText).not.toContain('STANDARD-ONLY');
      expect(advancedText).not.toContain('FROM-STANDARD');
      const output = await readFile(path.join(standardRun.directory, 'provider-output.txt'), 'utf8');
      expect(output).toContain('STANDARD-ONLY');
      expect((await readdir(standard.root)).every((name) => name.startsWith('standard-'))).toBe(true);
      expect((await readdir(advanced.root)).some((name) => name.startsWith('advanced-'))).toBe(true);
      const huge = `gsk_outputsecretvalue${'A'.repeat(70_000)}`;
      await standardRun.note(buildGroqExchange({
        provider: 'groq', model: 'openai/gpt-oss-20b', responseFormat: { type: 'json_schema' }, httpStatus: 400,
        cause: { status: 400, error: { code: 'json_validate_failed', failed_generation: huge } },
        fallbackMessage: 'schema', fallbackCode: 'invalid_code',
      }));
      const capped = await readFile(path.join(standardRun.directory, 'provider-output.txt'), 'utf8');
      expect(capped.length).toBeLessThanOrEqual(65_536);
      expect(capped).not.toContain('gsk_outputsecretvalue');
    } finally {
      await standard.cleanup();
      await advanced.cleanup();
    }
  });
});
