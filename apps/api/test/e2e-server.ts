// Test-only server. Production entrypoint never imports this module or enables mocks.
import { createApp } from '../src/app.js';
import { GameGenerationService } from '../src/services/game-generation-service.js';
import { RequestBudget } from '../src/services/request-budget.js';
import { AIError } from '../src/providers/errors.js';
import type { AIRequest } from '../src/providers/ai-provider.js';
import { mockProvider, mockRegistry, sampleSpec } from './fixtures.js';
import { agentFixture } from './agent-fixtures.js';

async function generate(input: AIRequest) {
  const properties = input.jsonSchema.properties as Record<string, unknown> | undefined;
  if (properties?.source || properties?.mechanics) return agentFixture(input);
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
  // Provider output must pass the production service's validation/repair path.
  return JSON.stringify(game);
}
const generationService = new GameGenerationService(mockRegistry([
  mockProvider('gemini', generate), mockProvider('groq', generate),
]), new RequestBudget({ requestsPerMinute: 1000, requestsPerDay: 10000 }));
const server = createApp({ generationService }).listen(Number(process.env.PORT ?? 3101), '127.0.0.1');
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
