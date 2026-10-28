import { randomUUID } from 'node:crypto';
import { GameProjectSchema, type GameProject, type GenerateGameRequest } from '@game-creator/contracts';
import type { GameProvider } from '../providers/game-provider.js';

export class GameService {
  constructor(private readonly provider: GameProvider) {}

  async generate(request: GenerateGameRequest): Promise<GameProject> {
    const game = await this.provider.generate(request);
    return GameProjectSchema.parse({
      id: randomUUID(),
      title: 'Moonlight Run',
      prompt: request.prompt,
      provider: 'demo',
      createdAt: new Date().toISOString(),
      game,
    });
  }
}
