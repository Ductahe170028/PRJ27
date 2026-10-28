import { GameSpecSchema, type GameSpec } from '@game-creator/contracts';
import type { AIProvider, AIRequest } from '../src/providers/ai-provider.js';
import { MODEL_CATALOG } from '../src/providers/model-catalog.js';
import { ProviderRegistry } from '../src/providers/provider-registry.js';

export function sampleSpec(genre: GameSpec['genre'] = 'platformer'): GameSpec {
  return GameSpecSchema.parse({
    version: '1.0', title: genre === 'platformer' ? 'Ninja Moon' : 'Neon Collector', genre, width: 960, height: 540,
    theme: { background: '#101b30', platform: '#32475f', player: '#c5f277', enemy: '#f27b91', collectible: '#ffd46b', accent: '#75c9cc' },
    player: { x: 100, y: genre === 'platformer' ? 460 : 300, size: 28, speed: 220, jumpSpeed: 500, health: 2 },
    platforms: genre === 'platformer' ? [{ x: 340, y: 420, width: 160, height: 20 }] : [],
    obstacles: [{ x: 500, y: genre === 'platformer' ? 470 : 300, width: 60, height: 60 }],
    enemies: [{ x: 780, y: genre === 'platformer' ? 484 : 300, size: 28, speed: 30, axis: 'horizontal', range: 40, damage: 1 }],
    collectibles: [{ x: 180, y: genre === 'platformer' ? 484 : 300, value: 10 }],
    controls: { movement: 'both', jump: 'both', restart: 'r' },
    win: { type: 'collect_all', scoreTarget: 10, surviveSeconds: 10 },
    lose: { healthDepleted: true, timeLimitSeconds: 60 },
    difficulty: { gravity: 1200, invulnerabilityMs: 500, enemySpeedMultiplier: 1 },
  });
}

export function mockProvider(id = 'gemini', generate: (request: AIRequest) => Promise<string> = async () => JSON.stringify(sampleSpec())): AIProvider {
  return { id, name: id === 'gemini' ? 'Google Gemini' : 'Groq', generate, testConnection: async () => {} };
}

export function mockRegistry(providers = [mockProvider(), mockProvider('groq')]) {
  return new ProviderRegistry(providers.map((provider) => ({
    provider, configured: true, freeTierConfirmed: true, models: MODEL_CATALOG[provider.id] ?? [],
  })));
}
