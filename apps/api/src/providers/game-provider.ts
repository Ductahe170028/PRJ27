import type { GameDefinition, GenerateGameRequest } from '@game-creator/contracts';

// Replace this implementation with an AI provider in a later phase.
// Providers return validated game data, never executable source.
export interface GameProvider {
  generate(request: GenerateGameRequest): Promise<GameDefinition>;
}
