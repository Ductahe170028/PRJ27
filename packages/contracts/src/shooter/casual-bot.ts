// A "casual" player: what the gate uses to judge whether a level can be won by a person who is
// not good at shooters. The expert bot (bot.ts) aims perfectly and reacts at once; this one
//  - looks at the field only every `reactionTicks` ticks and acts on what it saw until the next look,
//  - aims with a small random error that it keeps until the next look,
//  - fires only at a target inside part of the weapon's reach,
//  - keeps a smaller distance from enemies and walls than the expert, and has no route planning.
// Everything is deterministic: the error comes from this bot's own seeded generator (the game's
// seed), never from Math.random. The numbers are in CASUAL, ONE place, so they can be tuned
// without touching the logic. They are an estimate of a casual player, to be tuned with feedback
// from real players (docs/shooter-calibration.md).
import type { ShooterInput, ShooterState } from './state.js';
import { EXPERT_FLEE_RADIUS, EXPERT_WALL_RADIUS, steer, type Point } from './steering.js';

export interface CasualParams {
  /** Ticks between two looks at the field (60 ticks = 1 s). Reaction delay. */
  reactionTicks: number;
  /** Every look adds an aim error drawn evenly from +- this many degrees, kept until the next look. */
  aimErrorDeg: number;
  /** Fires only when the target is within this share of the weapon's range. */
  fireRangeShare: number;
  /** Enemies closer than this share of the expert's flee radius (150 px) push the bot away. */
  fleeScale: number;
  /** Walls and edges closer than this share of the expert's wall radius (60 px) push the bot away. */
  wallScale: number;
  /** Mixed into the game's seed so that the bot's mistakes do not repeat the game's own random numbers. */
  noiseSalt: number;
}

export const CASUAL: CasualParams = {
  // Tuned with scripts/calibrate-shooter.ts (docs/shooter-calibration.md). The first guess was 12 ticks and 5 degrees:
  // that bot was almost as good as the expert, so the win rates at intensity 2-4 stayed too high. Limits: at most 24 ticks, 12 degrees.
  reactionTicks: 18, // 300 ms
  aimErrorDeg: 12,
  fireRangeShare: 0.85,
  fleeScale: 0.8,
  wallScale: 0.5,
  noiseSalt: 0x5bd1e995,
};

const DEGREES = Math.PI / 180;
/** tan(x) for small x with + - * only (every engine rounds these the same way; Math.tan is not
 * guaranteed to). Error under 0.0001 up to 12 degrees. */
const tanSmall = (x: number) => x + (x * x * x) / 3 + (2 * x * x * x * x * x) / 15;

/** A fresh bot for ONE game: it keeps what it last saw. Make one per game, from that game's seed. */
export function createCasualBot(seed: number, params: CasualParams = CASUAL): (state: ShooterState) => ShooterInput {
  // mulberry32, the same generator as the simulation's, but this bot's own stream.
  let generator = (seed ^ params.noiseSalt) | 0;
  const random = () => {
    generator = (generator + 0x6d2b79f5) | 0;
    let t = Math.imul(generator ^ (generator >>> 15), 1 | generator);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const errorTan = tanSmall(params.aimErrorDeg * DEGREES);
  const fleeRadius = EXPERT_FLEE_RADIUS * params.fleeScale;
  const wallRadius = EXPERT_WALL_RADIUS * params.wallScale;

  let lastLook = -Infinity;
  /** Where the enemies were at the last look. */
  let seen: Point[] = [];
  let target: Point | undefined;
  /** The aim error of the last look, as a sideways share of the distance to the target. */
  let sideways = 0;

  return (state) => {
    const { player, level } = state;
    if (state.tick - lastLook >= params.reactionTicks) {
      lastLook = state.tick;
      seen = state.enemies.map((enemy) => ({ x: enemy.x, y: enemy.y }));
      target = nearestTo(player, seen);
      sideways = (random() * 2 - 1) * errorTan; // one draw per look, enemies or not
    }
    const { moveX, moveY } = steer(player, level, seen, fleeRadius, wallRadius);
    if (!target) return { moveX, moveY, aimX: player.x + 1, aimY: player.y, fire: false };
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const fire = distance <= level.weapon.range * params.fireRangeShare;
    // Aim a little to the side of where the target was seen: the same angle of error at any distance
    // (the sideways step is perpendicular to the line to the target and `distance * sideways` long).
    return { moveX, moveY, fire, aimX: target.x - dy * sideways, aimY: target.y + dx * sideways };
  };
}

function nearestTo(from: Point, points: readonly Point[]): Point | undefined {
  let best: Point | undefined;
  let bestDistance = Infinity;
  for (const point of points) {
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    const squared = dx * dx + dy * dy;
    if (squared < bestDistance) { bestDistance = squared; best = point; }
  }
  return best;
}

