// Test-only server. Production entrypoint never imports this module or enables mocks.
import { readFileSync, readdirSync } from 'node:fs';
import express from 'express';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { AgentOrchestrator } from '../src/agent/orchestrator.js';
import { PlaywrightGameTester } from '../src/agent/game-tester.js';
import { GameGenerationService } from '../src/services/game-generation-service.js';
import { RequestBudget } from '../src/services/request-budget.js';
import { AIError } from '../src/providers/errors.js';
import type { AIRequest } from '../src/providers/ai-provider.js';
import { mockProvider, mockRegistry, sampleSpec } from './fixtures.js';
import { agentFixture } from './agent-fixtures.js';
import { GroqRateLimiter } from '../src/providers/groq-rate-limit.js';
import { SHOOTER_BRIEF_SYSTEM_PROMPT } from '../src/shooter/prompt.js';
import { ShooterService } from '../src/shooter/service.js';

// Deterministic transport simulation; exercises the production scheduler and
// retry path without any credentials, network or real quota consumption.
const rateLimiter = new GroqRateLimiter();
let throttled = false;
const pacedGroq = {
  ...mockProvider('groq', async (input) => {
    if (input.prompt.includes('[agent-wait]')) {
      const properties = input.jsonSchema.properties as Record<string, unknown>;
      if (properties.mechanics) throttled = false;
      else if (!throttled) {
        throttled = true;
        throw rateLimiter.error(input.model.id, { status: 429, headers: new Headers({ 'retry-after': '3' }), error: { message: 'tokens per minute (TPM)' } });
      }
      rateLimiter.observe(input.model.id, new Headers({ 'x-ratelimit-remaining-tokens': '7000', 'x-ratelimit-reset-tokens': '1s' }));
      input.onTelemetry?.({ type: 'usage', provider: 'groq', model: input.model.id, inputTokens: 300, outputTokens: 600, totalTokens: 900,
        reasoningTokens: 10, estimatedInputTokens: 400, maxOutputTokens: input.maxOutputTokens ?? 4096, remainingTokens: 7000, limitTokens: 8000 });
    }
    return generate(input);
  }),
  prepare: async (input: AIRequest) => input.prompt.includes('[agent-wait]') ? rateLimiter.acquire(input) : () => {},
};

// `[fixture:<name>]` returns a recorded or synthetic GameSpec from
// test/fixtures/standard as the provider output. It still goes through the
// production parse, schema and repair path.
const fixtureDir = fileURLToPath(new URL('./fixtures/standard/', import.meta.url));
function standardFixture(prompt: string): string | undefined {
  const name = /\[fixture:([a-z0-9-]+)\]/.exec(prompt)?.[1];
  if (!name) return undefined;
  const files = readdirSync(fixtureDir).filter((file) => file === `${name}.json` || file.endsWith(`-${name}.json`));
  if (files.length !== 1) throw new Error(`Fixture ${name} matches ${files.length} files`);
  const fixture = JSON.parse(readFileSync(join(fixtureDir, files[0]!), 'utf8')) as { spec: unknown };
  return JSON.stringify(fixture.spec);
}

// The shooter brief: `[brief:<name>]` in the prompt picks test/fixtures/shooter/<name>.json
// (default ok-zombie). A fixture with `__raw` is returned as plain text (not JSON).
const briefDir = fileURLToPath(new URL('./fixtures/shooter/', import.meta.url));
function shooterBrief(prompt: string): string {
  const name = /\[brief:([a-z0-9-]+)\]/.exec(prompt)?.[1] ?? 'ok-zombie';
  const fixture = JSON.parse(readFileSync(join(briefDir, `${name}.json`), 'utf8')) as Record<string, unknown>;
  return typeof fixture.__raw === 'string' ? fixture.__raw : JSON.stringify(fixture);
}

async function generate(input: AIRequest) {
  if (input.systemPrompt === SHOOTER_BRIEF_SYSTEM_PROMPT) return shooterBrief(input.prompt);
  const properties = input.jsonSchema.properties as Record<string, unknown> | undefined;
  if (properties?.source || properties?.setup || properties?.update || properties?.mechanics) return agentFixture(input);
  const fixture = standardFixture(input.prompt);
  if (fixture) return fixture;
  if (input.prompt.includes('[quota]')) throw new AIError('rate_limit', 'Provider đã hết quota. Hãy thử lại sau.', 429, 60);
  const game = sampleSpec(input.prompt.includes('top-down') ? 'top-down' : 'platformer');
  if (input.prompt.includes('[survive]')) {
    game.player.health = 1;
    game.enemies = [{ ...game.enemies[0]!, x: 220, y: 300, range: 0 }];
    game.collectibles = [{ x: 180, y: 120, value: 10 }];
    game.win.type = 'survive';
  }
  if (input.prompt.includes('[obstacle]')) game.collectibles = [{ x: 840, y: 300, value: 10 }];
  if (input.prompt.includes('[jump]')) game.collectibles = [{ x: 840, y: 484, value: 10 }];
  if (input.prompt.includes('[repair]')) game.collectibles.push({ x: -8, y: game.collectibles[0]!.y, value: 25 });
  if (input.prompt.includes('[unrepairable]')) game.collectibles.push({ x: 900, y: 100, value: 25 });
  if (input.prompt.includes('[invalid-spec]')) game.title = 'Bad <title>';
  // Provider output must pass the production service's validation/repair path.
  return JSON.stringify(game);
}
const generationService = new GameGenerationService(mockRegistry([
  mockProvider('gemini', generate), pacedGroq,
]), new RequestBudget({ requestsPerMinute: 1000, requestsPerDay: 10000 }));
// E2E runs on a developer machine with the host Chromium; production wiring uses the Docker sandbox.
const agent = new AgentOrchestrator(generationService, new PlaywrightGameTester());
// Label every response, so a stray request to this server is never mistaken for
// the real API. The /api/health body cannot carry it: HealthResponseSchema is
// strict and the web client rejects any extra field.
// E2E_ADVANCED=0 starts the same server with Advanced switched off, as it is by
// default in the real API. The Advanced specs use the default here (on).
const advancedEnabled = process.env.E2E_ADVANCED !== '0';
const root = express();
root.use((_request, response, next) => { response.setHeader('X-Server-Mode', 'mock'); next(); });
// A fixed compiler seed: the same brief always gives the same level, so E2E results do not depend on luck.
const shooterService = new ShooterService(generationService, { seed: () => 20_261_122 });
root.use(createApp({ generationService, agent, advancedEnabled, shooterService }));
const port = Number(process.env.PORT ?? 3101);
const server = root.listen(port, '127.0.0.1', () => {
  console.warn(`\n=== MOCK SERVER – không gọi AI thật (http://127.0.0.1:${port}, header X-Server-Mode: mock, Advanced ${advancedEnabled ? 'bật' : 'tắt'}) ===\n`);
});
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
