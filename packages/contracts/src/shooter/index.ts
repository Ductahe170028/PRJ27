// Top-down Survival Shooter core. Pure TypeScript: it imports only zod and the
// files next to it, so any renderer, test or worker can run it unchanged.
// (It may become its own package later; nothing here needs the rest of contracts.)
export * from './constants.js';
export * from './geometry.js';
export * from './level.js';
export * from './navigation.js';
export { createSim, elapsedSeconds, totalScheduledEnemies } from './state.js';
export type { ShooterBullet, ShooterEnemy, ShooterInput, ShooterState } from './state.js';
export { step } from './sim.js';
export { snapshotHash } from './hash.js';
export * from './fixtures.js';
export * from './bot.js';
export * from './casual-bot.js';
