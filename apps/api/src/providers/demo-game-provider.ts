import type { GameDefinition } from '@game-creator/contracts';
import type { GameProvider } from './game-provider.js';

export class DemoGameProvider implements GameProvider {
  async generate(): Promise<GameDefinition> {
    return {
      template: 'platformer-v1',
      engine: 'phaser',
      engineMajor: 3,
      width: 960,
      height: 540,
      physics: { gravity: 1_200, moveSpeed: 260, jumpSpeed: 560 },
      spawn: { x: 90, y: 460 },
      platforms: [
        { x: 480, y: 520, width: 960, height: 40 },
        { x: 260, y: 408, width: 150, height: 22 },
        { x: 462, y: 318, width: 140, height: 22 },
        { x: 674, y: 244, width: 160, height: 22 },
        { x: 864, y: 164, width: 120, height: 22 },
      ],
    };
  }
}
