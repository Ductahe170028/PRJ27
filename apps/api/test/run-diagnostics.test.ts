import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { diagnosticSink } from '../src/providers/diagnostic-sink.js';
import { StructuredOutputError } from '../src/providers/errors.js';
import { buildGroqExchange } from '../src/providers/groq-exchange.js';
import { AiGateway } from '../src/services/ai-gateway.js';
import { DiagnosticsRun, diagnosticsEnabled } from '../src/services/run-diagnostics.js';
import { compileAndGate } from '../src/shooter/compile-job.js';
import { ShooterService } from '../src/shooter/service.js';
import { mockProvider, mockRegistry, sampleBrief } from './fixtures.js';

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
  const root = await mkdtemp(path.join(tmpdir(), 'run-diag-'));
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

const signal = () => new AbortController().signal;
const selection = { providerId: 'groq', prompt: 'zombie' };
/** The shooter service with the compiler in this process and the default (disk) diagnostics. */
const serviceFor = (answer: (prompt: string) => Promise<string>, options: ConstructorParameters<typeof ShooterService>[1] = {}) =>
  new ShooterService(new AiGateway(mockRegistry([mockProvider('groq', async (input) => answer(input.prompt))])), { compile: async (job) => compileAndGate(job), seed: () => 5, ...options });

describe('run diagnostics', () => {
  it('stay off in test and production, and a failed open does not change a successful game', async () => {
    expect(diagnosticsEnabled()).toBe(false);
    const { root, cleanup } = await tempRoot();
    try {
      process.env.STANDARD_DIAGNOSTICS_DIR = root;
      const project = await serviceFor(async () => JSON.stringify(sampleBrief())).generate({ ...selection, prompt: 'zombie' }, 'test', signal());
      expect(project.title).toBe('Zombie City');
      expect(await readdir(root)).toEqual([]);

      process.env.NODE_ENV = 'production';
      process.env.STANDARD_DIAGNOSTICS = '1';
      expect(diagnosticsEnabled()).toBe(false);
      process.env.NODE_ENV = 'development';
      process.env.STANDARD_DIAGNOSTICS = '0';
      expect(diagnosticsEnabled()).toBe(false);
    } finally { await cleanup(); }
  });

  it('store the invalid brief, full issues and sent prompt without secrets', async () => {
    const { root, cleanup } = await tempRoot();
    const prompt = `maze gsk_promptsecretvalue ${'x'.repeat(10)}`;
    const previousKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = 'gsk_envonlysecretvalue';
    process.env.STANDARD_DIAGNOSTICS = '1';
    process.env.STANDARD_DIAGNOSTICS_DIR = root;
    const raw = JSON.stringify({ ...sampleBrief(), theme: 'pirate-cove', leak: 'gsk_outputsecretvalue' });
    const prompts: string[] = [];
    const service = serviceFor(async (sent) => { prompts.push(sent); return raw; });
    try {
      await expect(service.generate({ ...selection, prompt }, 'test', signal())).rejects.toMatchObject({
        code: 'invalid_brief',
        details: expect.arrayContaining([expect.objectContaining({ path: 'theme', code: expect.any(String), message: expect.any(String) })]),
      });
      const runs = (await readdir(root)).filter((name) => name.startsWith('standard-'));
      expect(runs).toHaveLength(1);
      const directory = path.join(root, runs[0]!);
      const request = JSON.parse(await readFile(path.join(directory, 'request.json'), 'utf8')) as {
        runId: string; prompt: string; promptLength: number; provider: string; model: string;
      };
      const parsed = JSON.parse(await readFile(path.join(directory, 'parsed.json'), 'utf8')) as { theme: string };
      const validation = JSON.parse(await readFile(path.join(directory, 'validation.json'), 'utf8')) as {
        success: boolean; schema: string; issues: Array<{ path: string; code: string; message: string }>;
      };
      const summary = JSON.parse(await readFile(path.join(directory, 'summary.json'), 'utf8')) as {
        runId: string; stage: string; outcome: string; errorCode: string; issues: Array<{ path: string }>;
      };
      expect(request).toMatchObject({ runId: runs[0], promptLength: prompt.length, provider: 'groq', model: 'openai/gpt-oss-20b' });
      expect(prompts).toEqual([prompt]);
      expect(parsed.theme).toBe('pirate-cove');
      expect(validation).toMatchObject({ status: 'checked', schema: 'ShooterBriefSchema', success: false });
      expect(validation.issues.some((issue) => issue.path === 'theme' && issue.code && issue.message)).toBe(true);
      expect(summary).toMatchObject({ runId: runs[0], stage: 'schema', outcome: 'failed', reason: 'game_spec', errorCode: 'invalid_brief' });
      expect(summary.issues.some((issue) => issue.path === 'theme')).toBe(true);
      const stored = await treeText(directory);
      expect(stored).not.toContain('gsk_promptsecretvalue');
      expect(stored).not.toContain('gsk_outputsecretvalue');
      expect(stored).not.toContain('gsk_envonlysecretvalue');
      expect(previousKey ? stored.includes(previousKey) : false).toBe(false);
      expect(await readFile(path.join(directory, 'provider-output.txt'), 'utf8')).not.toContain('gsk_outputsecretvalue');
    } finally { await cleanup(); }
  });

  it('record a completed run, with the compile report, without changing the game', async () => {
    const { root, cleanup } = await tempRoot();
    process.env.STANDARD_DIAGNOSTICS = '1';
    process.env.STANDARD_DIAGNOSTICS_DIR = root;
    try {
      const project = await serviceFor(async () => JSON.stringify(sampleBrief())).generate({ ...selection, prompt: 'zombie maze' }, 'test', signal());
      expect(project.title).toBe('Zombie City');
      const runs = await readdir(root);
      expect(runs).toHaveLength(1);
      const summary = JSON.parse(await readFile(path.join(root, runs[0]!, 'summary.json'), 'utf8')) as { stage: string; outcome: string; compile?: { runs: number } };
      const validation = JSON.parse(await readFile(path.join(root, runs[0]!, 'validation.json'), 'utf8')) as { success: boolean };
      expect(summary).toMatchObject({ stage: 'response', outcome: 'completed', reason: 'completed' });
      expect(summary.compile).toBeDefined();
      expect(validation).toMatchObject({ status: 'checked', success: true });
    } finally { await cleanup(); }
  });

  it('ignore a write failure and a directory that cannot be created', async () => {
    const { root, cleanup } = await tempRoot();
    try {
      const run = new DiagnosticsRun('standard-test', root, { writeFile: async () => { throw new Error('disk full'); } });
      await expect(run.note({
        provider: 'groq', model: 'openai/gpt-oss-20b', contentPresent: true, failedGenerationPresent: true,
        rawContent: 'gsk_outputsecretvalue', usage: null, httpStatus: 400, errorCode: 'json_validate_failed', schemaPath: '/properties/title',
      })).resolves.toBeUndefined();
      await expect(run.raw('gsk_outputsecretvalue')).resolves.toBeUndefined();
      await expect(run.finish({
        stage: 'schema', outcome: 'failed', raw: 'gsk_outputsecretvalue', parsed: { theme: 'pirate-cove' }, normalized: null,
        validation: { status: 'checked', schema: 'ShooterBriefSchema', success: false, issues: [{ path: 'theme', code: 'invalid_value', message: 'Giá trị không hợp lệ.' }] },
        issues: [{ path: 'theme', code: 'invalid_value', message: 'Giá trị không hợp lệ.' }],
        errorCode: 'invalid_brief', errorMessage: 'bad',
      })).resolves.toBeUndefined();

      const disk = {
        note: vi.fn(async () => { throw new Error('disk full'); }),
        raw: vi.fn(async () => { throw new Error('disk full'); }),
        finish: vi.fn(async () => { throw new Error('disk full'); }),
      };
      await expect(serviceFor(async () => JSON.stringify(sampleBrief()), { openDiagnostics: async () => disk })
        .generate({ ...selection, prompt: 'zombie' }, 'test', signal())).resolves.toMatchObject({ title: 'Zombie City' });
      expect(disk.finish).toHaveBeenCalledOnce();

      const failingDisk = { note: async () => { throw new Error('disk full'); }, raw: async () => { throw new Error('disk full'); }, finish: async () => { throw new Error('disk full'); } };
      await expect(serviceFor(async () => 'not json', { openDiagnostics: async () => failingDisk }).generate({ ...selection, prompt: 'zombie' }, 'test', signal()))
        .rejects.toMatchObject({ code: 'invalid_brief', message: expect.stringContaining('JSON') });

      const blocked = path.join(root, 'not-a-directory');
      await writeFile(blocked, 'x');
      process.env.STANDARD_DIAGNOSTICS = '1';
      process.env.STANDARD_DIAGNOSTICS_DIR = blocked;
      await expect(serviceFor(async () => JSON.stringify(sampleBrief())).generate({ ...selection, prompt: 'zombie' }, 'test', signal()))
        .resolves.toMatchObject({ title: 'Zombie City' });
    } finally { await cleanup(); }
  });

  it('keep every run to its own exchange, and cap and redact a huge output', async () => {
    const first = await tempRoot();
    const second = await tempRoot();
    process.env.STANDARD_DIAGNOSTICS = '1';
    process.env.STANDARD_DIAGNOSTICS_DIR = first.root;
    const exchange = (title: string, schemaPath?: string) => buildGroqExchange({
      provider: 'groq', model: 'openai/gpt-oss-20b',
      responseFormat: { type: 'json_schema', json_schema: { name: 'shooter_brief_v1', strict: true, schema: { type: 'object' } } },
      httpStatus: 400,
      cause: { status: 400, error: { code: 'json_validate_failed', failed_generation: `{"title":"${title}"}`, ...(schemaPath ? { schema_path: schemaPath } : {}) } },
      fallbackMessage: 'Groq trả JSON do model sinh không khớp schema (json_validate_failed).',
      fallbackCode: 'invalid_code',
    });
    try {
      const firstRun = await DiagnosticsRun.create({ prompt: 'first prompt', provider: 'groq', model: 'openai/gpt-oss-20b' }, first.root);
      const secondRun = await DiagnosticsRun.create({ prompt: 'second prompt', provider: 'groq', model: 'openai/gpt-oss-20b' }, second.root);
      await firstRun.note(exchange('FIRST-ONLY', '/properties/title'));
      await secondRun.note(exchange('SECOND-ONLY'));
      // A request that runs inside the second run's sink writes to the second run, not to the one opened from the environment.
      const provider = mockProvider('groq', async () => {
        await diagnosticSink.getStore()?.note(exchange('FROM-SECOND', '/properties/title'));
        throw new StructuredOutputError('Groq trả JSON do model sinh không khớp schema (json_validate_failed).', '{"title":"FROM-SECOND"}', '/properties/title', 400);
      });
      await diagnosticSink.run(secondRun, async () => {
        await expect(new AiGateway(mockRegistry([provider])).generateArtifact({ providerId: 'groq' }, { prompt: 'shadow maze', systemPrompt: 's', jsonSchema: {} }, 'test', signal()))
          .rejects.toMatchObject({ code: 'invalid_code' });
      });
      const firstText = await treeText(first.root);
      const secondText = await treeText(second.root);
      expect(firstText).toContain('FIRST-ONLY');
      expect(firstText).not.toContain('SECOND-ONLY');
      expect(firstText).not.toContain('FROM-SECOND');
      expect(secondText).toContain('FROM-SECOND');
      expect(secondText).not.toContain('FIRST-ONLY');
      expect(await readFile(path.join(firstRun.directory, 'provider-output.txt'), 'utf8')).toContain('FIRST-ONLY');
      expect((await readdir(first.root)).every((name) => name.startsWith('standard-'))).toBe(true);
      const huge = `gsk_outputsecretvalue${'A'.repeat(70_000)}`;
      await firstRun.note(buildGroqExchange({
        provider: 'groq', model: 'openai/gpt-oss-20b', responseFormat: { type: 'json_schema' }, httpStatus: 400,
        cause: { status: 400, error: { code: 'json_validate_failed', failed_generation: huge } },
        fallbackMessage: 'schema', fallbackCode: 'invalid_code',
      }));
      const capped = await readFile(path.join(firstRun.directory, 'provider-output.txt'), 'utf8');
      expect(capped.length).toBeLessThanOrEqual(65_536);
      expect(capped).not.toContain('gsk_outputsecretvalue');
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
  });
});
