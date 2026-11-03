import { expect, it, vi } from 'vitest';
import { CodeGenerator, CodeRepairAgent, GamePlanner, readSource } from '../src/agent/agents.js';
import { CodeValidator } from '../src/agent/code-validator.js';
import { GameGenerationService } from '../src/services/game-generation-service.js';
import { RequestCapacityError } from '../src/providers/errors.js';
import { estimateInputTokens } from '../src/providers/groq-rate-limit.js';
import type { AIRequest } from '../src/providers/ai-provider.js';
import { mockRegistry, mockProvider } from './fixtures.js';
import { shooterPlan, shooterSource } from './agent-fixtures.js';

const request = { providerId: 'groq', prompt: 'Máy bay, đạn, boss và 7 kẻ địch' };
const signal = new AbortController().signal;
const body = (source: string) => source.slice(source.indexOf('{') + 1, source.lastIndexOf('}'));
const [create, update] = shooterSource.split('function update');
const parts = { setup: body(create!), update: body(update!), helpers: '' };
function harness(outputs: Array<string | Error>) {
  const generate = vi.fn(async (_request: AIRequest) => { const result = outputs.shift(); if (result instanceof Error) throw result; return result ?? ''; });
  return { generate, service: new GameGenerationService(mockRegistry([mockProvider('groq', generate)])) };
}

it('bounds plan/code outputs, omits display-only metadata and assembles typed entrypoints without changing gameplay', async () => {
  const h = harness([JSON.stringify(shooterPlan), JSON.stringify(parts)]);
  await new GamePlanner(h.service).plan(request, 'test', signal);
  const source = readSource(await new CodeGenerator(h.service).generate(request, shooterPlan, 'test', signal))!;
  expect(h.generate.mock.calls.map(([input]) => input.maxOutputTokens)).toEqual([450, 2400]);
  const context = h.generate.mock.calls[1]![0].prompt;
  expect(context).toContain(request.prompt);
  expect(context).not.toContain(shooterPlan.summary);
  expect(context).not.toContain(shooterPlan.title);
  expect(source).toContain(parts.update);
  expect(new CodeValidator().validate(source).errors).toEqual([]);
});

it('sends repair source once without JSON re-escaping or truncation and deduplicates diagnostics', async () => {
  const h = harness([JSON.stringify(parts)]);
  await new CodeRepairAgent(h.service).repair(request, shooterPlan, shooterSource, ['duplicate error', 'duplicate error', 'next error'], 'test', signal);
  const context = h.generate.mock.calls[0]![0].prompt;
  expect(context.split(shooterSource)).toHaveLength(2);
  expect(context.split('duplicate error')).toHaveLength(2);
  expect(context).toContain('next error');
  expect(context).not.toContain('\\"player\\"');
});

it('splits an oversized request into coherent setup and gameplay with the original requirements in both', async () => {
  const h = harness([new RequestCapacityError(3000, 1500, 2400), JSON.stringify({ setup: parts.setup }), JSON.stringify({ update: parts.update, helpers: '' })]);
  const output = await new CodeGenerator(h.service).generate(request, shooterPlan, 'test', signal);
  const inputs = h.generate.mock.calls.map(([input]) => input);
  expect(inputs).toHaveLength(3);
  for (const input of inputs.slice(1)) {
    expect(input.prompt).toContain(request.prompt);
    expect(estimateInputTokens(input) + input.maxOutputTokens!).toBeLessThanOrEqual(3000 - 128);
  }
  expect(inputs[2]!.prompt).toContain(parts.setup);
  expect(new CodeValidator().validate(readSource(output)!).errors).toEqual([]);
  expect(readSource(output)).toContain('boss.hp = 6');
});

it('rebuilds oversized repair context from complete requirements instead of truncating broken source', async () => {
  const h = harness([new RequestCapacityError(3000, 5000, 2400), JSON.stringify({ setup: parts.setup }), JSON.stringify({ update: parts.update, helpers: '' })]);
  await new CodeRepairAgent(h.service).repair(request, shooterPlan, 'broken'.repeat(3000), ['syntax error'], 'test', signal);
  const inputs = h.generate.mock.calls.map(([input]) => input);
  expect(inputs[0]!.prompt).toContain('broken'.repeat(3000));
  expect(inputs[1]!.prompt).not.toContain('broken');
  expect(inputs[2]!.prompt).toContain('syntax error');
});

it('fails clearly if even a logical part cannot fit, without sending another request', async () => {
  const h = harness([new RequestCapacityError(1000, 1500, 2400)]);
  await expect(new CodeGenerator(h.service).generate(request, shooterPlan, 'test', signal)).rejects.toBeInstanceOf(RequestCapacityError);
  expect(h.generate).toHaveBeenCalledOnce();
});

it('does not bypass static security validation for code returned as bodies', async () => {
  const h = harness([JSON.stringify({ ...parts, setup: "fetch('https://evil.test');" })]);
  const source = readSource(await new CodeGenerator(h.service).generate(request, shooterPlan, 'test', signal))!;
  expect(new CodeValidator().validate(source).errors.join()).toContain('fetch');
});

it('rejects extra/missing part fields and never executes partial output', async () => {
  const h = harness([JSON.stringify({ setup: parts.setup, update: '', helpers: '', extra: 'bad' })]);
  await expect(new CodeGenerator(h.service).generate(request, shooterPlan, 'test', signal)).rejects.toMatchObject({ code: 'invalid_code' });
});
