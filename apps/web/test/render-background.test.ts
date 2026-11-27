import { describe, expect, it } from 'vitest';
import { SHOOTER_LEVELS } from '@game-creator/contracts';
import { SHADOW_OFFSET, paintGround, type GroundContext } from '../src/game/render/background';
import { placeProps } from '../src/game/render/props';
import { BIOME_PACKS } from '../src/game/art/procedural/biomes';

/** A 2D context that only writes down what it is asked to do. */
function recorder() {
  const calls: string[] = [];
  const gradient = { addColorStop: (offset: number, colorStop: string) => calls.push(`stop ${offset} ${colorStop}`) };
  const state: Record<string, unknown> = {};
  const ctx = new Proxy({}, {
    get: (_target, name: string) => {
      if (name in state) return state[name];
      if (name === 'createRadialGradient') return (...args: number[]) => { calls.push(`createRadialGradient ${args.join(',')}`); return gradient; };
      if (name === 'createPattern') return (_source: unknown, repeat: string) => { calls.push(`createPattern ${repeat}`); return 'PATTERN'; };
      return (...args: unknown[]) => { calls.push(`${name} ${args.filter((a) => typeof a === 'number').join(',')}`); };
    },
    set: (_target, name: string, value: unknown) => { state[name] = value; if (name === 'fillStyle') calls.push(`fillStyle ${typeof value === 'string' ? value : 'object'}`); return true; },
  }) as unknown as GroundContext;
  return { ctx, calls };
}

const biome = BIOME_PACKS['zombie-city']!.manifest;
const paint = (levelName: keyof typeof SHOOTER_LEVELS) => {
  const level = SHOOTER_LEVELS[levelName];
  const { ctx, calls } = recorder();
  const props = placeProps(level, biome.props ?? []);
  const tiles: string[] = [];
  paintGround(ctx, level, biome, {} as CanvasImageSource, props, (_sheet, x, y, w, h) => { tiles.push(`${x},${y},${w},${h}`); return {} as CanvasImageSource; });
  return { calls, props, tiles, level };
};

describe('painting the ground once', () => {
  it('covers the whole field with one tile per 64 x 64 cell (15 x 9)', () => {
    const { calls } = paint('arena');
    const cells = calls.filter((call) => call.startsWith('drawImage')).filter((call) => call.endsWith(',64,64')).length;
    expect(cells).toBeGreaterThanOrEqual(15 * 9);
  });

  it('draws every prop at its place, and one wall (with a shadow) per obstacle', () => {
    const { calls, props, level } = paint('pillars');
    expect(props.length).toBeGreaterThanOrEqual(25);
    const propDraws = calls.filter((call) => call.startsWith('drawImage')).length - 15 * 9;
    expect(propDraws).toBe(props.length);
    expect(calls.filter((call) => call.startsWith('strokeRect')).length).toBe(level.obstacles.length);
    const first = level.obstacles[0]!;
    const shadow = `fillRect ${first.x - first.width / 2 + SHADOW_OFFSET},${first.y - first.height / 2 + SHADOW_OFFSET},${first.width},${first.height}`;
    expect(calls).toContain(shadow);
  });

  it('cuts the wall texture out of the sheet once, to repeat it', () => {
    const { calls, tiles } = paint('pillars');
    expect(tiles).toEqual([`${biome.wall!.x},${biome.wall!.y},${biome.wall!.w},${biome.wall!.h}`]);
    expect(calls.filter((call) => call === 'createPattern repeat')).toHaveLength(1);
  });

  it('darkens the corners last, lightly', () => {
    const { calls } = paint('arena');
    expect(calls.some((call) => call.startsWith('createRadialGradient'))).toBe(true);
    const last = calls.at(-1)!;
    expect(last).toBe('fillRect 0,0,960,540');
    const stop = calls.filter((call) => call.startsWith('stop')).at(-1)!;
    expect(stop).toBe('stop 1 rgba(0,0,0,0.38)');
  });

  it('is exactly the same for the same level (it is decided by the seed, never by chance)', () => {
    expect(paint('base-siege').calls).toEqual(paint('base-siege').calls);
    expect(paint('arena').calls).not.toEqual(paint('wall').calls);
  });

  it('works for a pack with no props and no wall', () => {
    const { ctx, calls } = recorder();
    const bare = { ...biome, props: undefined, wall: undefined };
    paintGround(ctx, SHOOTER_LEVELS.pillars, bare as typeof biome, {} as CanvasImageSource, [], () => ({}) as CanvasImageSource);
    expect(calls.filter((call) => call.startsWith('strokeRect')).length).toBe(SHOOTER_LEVELS.pillars.obstacles.length);
  });
});
