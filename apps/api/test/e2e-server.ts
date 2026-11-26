// Test-only server. Production entrypoint never imports this module or enables mocks.
import { readFileSync } from 'node:fs';
import express from 'express';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { AiGateway } from '../src/services/ai-gateway.js';
import { RequestBudget } from '../src/services/request-budget.js';
import { AIError } from '../src/providers/errors.js';
import type { AIRequest } from '../src/providers/ai-provider.js';
import { ShooterService } from '../src/shooter/service.js';
import { mockProvider, mockRegistry } from './fixtures.js';

// The shooter brief: `[brief:<name>]` in the prompt picks test/fixtures/shooter/<name>.json
// (default ok-zombie). A fixture with `__raw` is returned as plain text (not JSON).
// `[quota]` answers like a provider that is out of quota.
const briefDir = fileURLToPath(new URL('./fixtures/shooter/', import.meta.url));
async function generate(input: AIRequest) {
  if (input.prompt.includes('[quota]')) throw new AIError('rate_limit', 'Provider đã hết quota. Hãy thử lại sau.', 429, 60);
  const name = /\[brief:([a-z0-9-]+)\]/.exec(input.prompt)?.[1] ?? 'ok-zombie';
  const fixture = JSON.parse(readFileSync(join(briefDir, `${name}.json`), 'utf8')) as Record<string, unknown>;
  return typeof fixture.__raw === 'string' ? fixture.__raw : JSON.stringify(fixture);
}
const gateway = new AiGateway(mockRegistry([mockProvider('gemini', generate), mockProvider('groq', generate)]), new RequestBudget({ requestsPerMinute: 1000, requestsPerDay: 10000 }));
// Label every response, so a stray request to this server is never mistaken for
// the real API. The /api/health body cannot carry it: HealthResponseSchema is
// strict and the web client rejects any extra field.
const root = express();
root.use((_request, response, next) => { response.setHeader('X-Server-Mode', 'mock'); next(); });
// A fixed compiler seed: the same brief always gives the same level, so E2E results do not depend on luck.
const shooterService = new ShooterService(gateway, { seed: () => 20_261_122 });
root.use(createApp({ gateway, shooterService }));
const port = Number(process.env.PORT ?? 3101);
const server = root.listen(port, '127.0.0.1', () => {
  console.warn(`\n=== MOCK SERVER – không gọi AI thật (http://127.0.0.1:${port}, header X-Server-Mode: mock) ===\n`);
});
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
