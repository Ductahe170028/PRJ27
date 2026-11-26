import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { MODEL_CATALOG } from '../src/providers/model-catalog.js';
import { GroqProvider } from '../src/providers/groq-provider.js';
import { ProviderRegistry } from '../src/providers/provider-registry.js';
import { createApp } from '../src/app.js';
import { AiGateway } from '../src/services/ai-gateway.js';
import { compileAndGate } from '../src/shooter/compile-job.js';
import { ShooterService } from '../src/shooter/service.js';
import { sampleBrief } from './fixtures.js';

const sdk = vi.hoisted(() => ({ groqGenerate: vi.fn() }));
vi.mock('groq-sdk', () => ({ default: class {
  chat = { completions: { create: () => ({ withResponse: async () => ({ data: await sdk.groqGenerate(), response: new Response() }) }) } };
  models = { list: vi.fn(), retrieve: vi.fn() };
} }));

const saved = {
  NODE_ENV: process.env.NODE_ENV,
  STANDARD_DIAGNOSTICS: process.env.STANDARD_DIAGNOSTICS,
  STANDARD_DIAGNOSTICS_DIR: process.env.STANDARD_DIAGNOSTICS_DIR,
};
afterEach(() => {
  restore('NODE_ENV', saved.NODE_ENV);
  restore('STANDARD_DIAGNOSTICS', saved.STANDARD_DIAGNOSTICS);
  restore('STANDARD_DIAGNOSTICS_DIR', saved.STANDARD_DIAGNOSTICS_DIR);
});
beforeEach(() => vi.resetAllMocks());

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** The API on the real Groq adapter (its SDK is mocked above); the compiler runs in this process. */
function serve() {
  const gateway = new AiGateway(new ProviderRegistry([{
    provider: new GroqProvider('test-key'), configured: true, models: MODEL_CATALOG.groq ?? [],
  }]));
  return createApp({ gateway, shooterService: new ShooterService(gateway, { compile: async (job) => compileAndGate(job) }) });
}

async function tempRoot(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'run-groq-'));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function enable(root: string) {
  process.env.STANDARD_DIAGNOSTICS = '1';
  process.env.STANDARD_DIAGNOSTICS_DIR = root;
}

async function runDirectory(root: string): Promise<string> {
  const runs = (await readdir(root)).filter((name) => name.startsWith('standard-'));
  expect(runs).toHaveLength(1);
  return path.join(root, runs[0]!);
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
}

const body = { providerId: 'groq', modelId: 'openai/gpt-oss-20b', prompt: 'shadow maze' };

describe('run diagnostics for Groq structured output', () => {
  it('stores a redacted failed generation and schema path without returning them over HTTP', async () => {
    const { root, cleanup } = await tempRoot();
    await enable(root);
    const failed = '{"title":"REJECTED-FIELD","leak":"gsk_outputsecretvalue"}';
    sdk.groqGenerate.mockRejectedValue({
      status: 400,
      error: { code: 'json_validate_failed', failed_generation: failed, schema_path: '/properties/title', message: 'upstream gsk_upstreamsecret' },
    });
    try {
      const response = await request(serve()).post('/api/shooter/generate').send(body).expect(422);
      expect(response.body.error.code).toBe('invalid_code');
      const wire = JSON.stringify(response.body);
      expect(wire).not.toContain('REJECTED-FIELD');
      expect(wire).not.toContain('gsk_outputsecretvalue');
      expect(wire).not.toContain('gsk_upstreamsecret');
      expect(wire).not.toContain('failed_generation');
      expect(wire).not.toContain('schemaPath');
      const directory = await runDirectory(root);
      const output = await readFile(path.join(directory, 'provider-output.txt'), 'utf8');
      const summary = await readJson(path.join(directory, 'summary.json'));
      const validation = await readJson(path.join(directory, 'validation.json'));
      const exchange = await readJson(path.join(directory, 'provider-exchange.json'));
      expect(output).toContain('REJECTED-FIELD');
      expect(output).not.toContain('gsk_outputsecretvalue');
      expect(output).not.toContain('test-key');
      expect(summary).toMatchObject({
        stage: 'provider', reason: 'schema_mismatch', errorCode: 'invalid_code',
        httpStatus: 400, schemaCode: 'json_validate_failed', schemaPath: '/properties/title',
        failedGenerationPresent: true, contentPresent: true,
      });
      expect(validation).toEqual({ status: 'not_reached' });
      expect(exchange).toMatchObject({ httpStatus: 400, schemaCode: 'json_validate_failed', schemaPath: '/properties/title' });
      expect(JSON.stringify(exchange)).not.toContain('gsk_');
      expect(JSON.stringify(exchange)).not.toContain('REJECTED-FIELD');
      expect(await readFile(path.join(directory, 'parsed.json'), 'utf8')).toBe('null\n');
    } finally { await cleanup(); }
  });

  it('records schema rejection when Groq returns no failed generation', async () => {
    const { root, cleanup } = await tempRoot();
    await enable(root);
    sdk.groqGenerate.mockRejectedValue({
      status: 400,
      error: { code: 'json_validate_failed', message: 'upstream gsk_rejectedsecret', schema_path: '/properties/title/pattern' },
    });
    try {
      const response = await request(serve()).post('/api/shooter/generate').send(body).expect(422);
      expect(JSON.stringify(response.body)).not.toContain('gsk_rejectedsecret');
      expect(JSON.stringify(response.body)).not.toContain('upstream');
      const directory = await runDirectory(root);
      const summary = await readJson(path.join(directory, 'summary.json'));
      expect(summary).toMatchObject({
        reason: 'schema_rejected', schemaCode: 'json_validate_failed', schemaPath: '/properties/title/pattern',
        failedGenerationPresent: false, httpStatus: 400,
      });
      expect(await readJson(path.join(directory, 'validation.json'))).toEqual({ status: 'not_reached' });
      await expect(readFile(path.join(directory, 'provider-output.txt'), 'utf8')).rejects.toThrow();
    } finally { await cleanup(); }
  });

  it('keeps schema_path absent when Groq does not send one', async () => {
    const { root, cleanup } = await tempRoot();
    await enable(root);
    sdk.groqGenerate.mockRejectedValue({
      status: 400,
      error: { code: 'json_validate_failed', failed_generation: '{"title":"NO-PATH"}' },
    });
    try {
      await request(serve()).post('/api/shooter/generate').send(body).expect(422);
      const summary = await readJson(path.join(await runDirectory(root), 'summary.json'));
      expect(summary.reason).toBe('schema_mismatch');
      expect(summary.schemaPath).toBeUndefined();
      expect(summary.schemaCode).toBe('json_validate_failed');
      expect(await readFile(path.join(await runDirectory(root), 'provider-output.txt'), 'utf8')).toContain('NO-PATH');
    } finally { await cleanup(); }
  });

  it('distinguishes empty provider content, invalid JSON, and brief validation', async () => {
    const cases = [
      {
        name: 'no_content',
        reply: { choices: [{ finish_reason: 'length', message: { content: '' } }] },
        reason: 'no_content',
        validation: { status: 'not_reached' },
        output: undefined,
      },
      {
        name: 'invalid_json',
        reply: { choices: [{ finish_reason: 'stop', message: { content: 'not json' } }] },
        reason: 'invalid_json',
        validation: { status: 'not_reached' },
        output: 'not json',
      },
    ] as const;
    for (const item of cases) {
      const { root, cleanup } = await tempRoot();
      await enable(root);
      sdk.groqGenerate.mockResolvedValue(item.reply);
      try {
        await request(serve()).post('/api/shooter/generate').send(body).expect(422);
        const directory = await runDirectory(root);
        const summary = await readJson(path.join(directory, 'summary.json'));
        expect(summary.reason).toBe(item.reason);
        expect(await readJson(path.join(directory, 'validation.json'))).toEqual(item.validation);
        if (item.output === undefined) await expect(readFile(path.join(directory, 'provider-output.txt'), 'utf8')).rejects.toThrow();
        else expect(await readFile(path.join(directory, 'provider-output.txt'), 'utf8')).toContain(item.output);
      } finally { await cleanup(); }
    }

    const { root, cleanup } = await tempRoot();
    await enable(root);
    const brief = { ...sampleBrief(), theme: 'pirate-cove' };
    sdk.groqGenerate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(brief) } }] });
    try {
      await request(serve()).post('/api/shooter/generate').send(body).expect(422);
      const directory = await runDirectory(root);
      const summary = await readJson(path.join(directory, 'summary.json'));
      const validation = await readJson(path.join(directory, 'validation.json'));
      expect(summary).toMatchObject({ stage: 'schema', reason: 'game_spec', errorCode: 'invalid_brief' });
      expect(validation).toMatchObject({
        status: 'checked', success: false,
        issues: [expect.objectContaining({ path: 'theme' })],
      });
    } finally { await cleanup(); }
  });
});
