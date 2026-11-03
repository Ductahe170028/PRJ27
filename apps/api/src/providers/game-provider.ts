import type { GameDefinition, GenerateGameRequest } from '@game-creator/contracts';

// Phase 1 demo contract. AI generation uses the separate AIProvider interface.
export interface GameProvider {
  generate(request: GenerateGameRequest): Promise<GameDefinition>;
}
