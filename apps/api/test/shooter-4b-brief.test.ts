import { describe, expect, it } from 'vitest';
import { ShooterLevelSchema } from '@game-creator/contracts';
import {
  BRIEF_ENEMY_TYPES, HEALTH_DROPS, SHOOTER_MAPS, ShooterBriefSchema, WEAPONS, normalizeBrief, type ShooterBrief,
} from '../src/shooter/brief.js';
import { compileShooter } from '../src/shooter/compile.js';
import { HEALTH_DROP_PCT, WEAPONS as WEAPON_PRESETS } from '../src/shooter/presets.js';
import { SHOOTER_BRIEF_SYSTEM_PROMPT, briefJsonSchema, describeBrief } from '../src/shooter/prompt.js';
import { deriveRng } from '../src/shooter/rng.js';
import { BRUTE_NOT_BEFORE, ENEMY_WEIGHT, SPITTER_NOT_BEFORE, scheduleWaves } from '../src/shooter/waves.js';

const raw = (patch: Record<string, unknown> = {}) => ({
  version: 'brief-1', healthDrops: 'none', boss: 'none', title: 'Stage 4B', theme: 'zombie-city', map: 'pillars',
  enemies: [{ type: 'runner', share: 5 }, { type: 'swarmer', share: 5 }],
  intensity: 3, playerHealth: 'normal', weapon: 'pistol', goal: { type: 'survive', seconds: 60 }, unsupported: [] as unknown[], ...patch,
}) as Record<string, any>;
const brief = (patch: Record<string, unknown> = {}): ShooterBrief => ShooterBriefSchema.parse(normalizeBrief(raw(patch)));

describe('the brief takes the new words', () => {
  it('lists: spitter, two more weapons, healthDrops', () => {
    expect([...BRIEF_ENEMY_TYPES]).toEqual(['runner', 'brute', 'swarmer', 'spitter']);
    expect([...WEAPONS]).toEqual(['pistol', 'rapid', 'heavy', 'shotgun', 'piercing']);
    expect([...HEALTH_DROPS]).toEqual(['none', 'some', 'many']);
    for (const weapon of WEAPONS) expect(ShooterBriefSchema.safeParse(raw({ weapon })).success, weapon).toBe(true);
    expect(ShooterBriefSchema.safeParse(raw({ enemies: [{ type: 'spitter', share: 3 }] })).success).toBe(true);
  });

  it('healthDrops: missing becomes "none" (the only guess); a value that is there but wrong is refused', () => {
    const { healthDrops: _omit, ...without } = raw();
    void _omit;
    const normalized = normalizeBrief(without) as Record<string, unknown>;
    expect(normalized.healthDrops).toBe('none');
    expect(ShooterBriefSchema.safeParse(normalized).success).toBe(true);
    for (const value of ['some', 'many', 'none']) expect(ShooterBriefSchema.safeParse(normalizeBrief(raw({ healthDrops: value }))).success, value).toBe(true);
    for (const bad of ['lots', 'SOME', '', null, 3, true]) {
      const result = ShooterBriefSchema.safeParse(normalizeBrief(raw({ healthDrops: bad })));
      expect(result.success, String(bad)).toBe(false);
      if (!result.success) expect(result.error.issues.map((i) => i.path.join('.'))).toContain('healthDrops');
    }
    // and the schema itself needs it: a model that left it out is not "valid as is"
    expect(ShooterBriefSchema.safeParse(without).success).toBe(false);
  });

  it('enemies: four kinds are accepted, a fifth entry is cut, the same kind twice is merged', () => {
    const four = [{ type: 'runner', share: 1 }, { type: 'brute', share: 1 }, { type: 'swarmer', share: 1 }, { type: 'spitter', share: 1 }];
    expect(ShooterBriefSchema.safeParse(normalizeBrief(raw({ enemies: four }))).success).toBe(true);
    const merged = normalizeBrief(raw({ enemies: [...four, { type: 'spitter', share: 4 }] })) as { enemies: Array<{ type: string; share: number }> };
    expect(merged.enemies).toHaveLength(4);
    expect(merged.enemies.find((e) => e.type === 'spitter')!.share).toBe(5);
  });
});

describe('the compiler writes the new fields, and only when they were asked for', () => {
  it('healthDrops none: the level has no "drops" key at all; some and many: 12 and 25 percent', () => {
    expect(HEALTH_DROP_PCT).toEqual({ none: 0, some: 12, many: 25 });
    const none = compileShooter(brief(), 7).level;
    expect('drops' in none).toBe(false);
    expect(compileShooter(brief({ healthDrops: 'some' }), 7).level.drops).toEqual({ healthChancePct: 12 });
    expect(compileShooter(brief({ healthDrops: 'many' }), 7).level.drops).toEqual({ healthChancePct: 25 });
  });

  it('each weapon writes exactly its preset: the old three have none of the new fields', () => {
    for (const weapon of WEAPONS) {
      const level = compileShooter(brief({ weapon }), 3).level;
      expect(level.weapon, weapon).toEqual(WEAPON_PRESETS[weapon]);
    }
    for (const old of ['pistol', 'rapid', 'heavy'] as const) {
      expect(Object.keys(WEAPON_PRESETS[old]).sort(), old).toEqual(['bulletSpeed', 'cooldownMs', 'damage', 'range']);
    }
    expect(WEAPON_PRESETS.shotgun).toEqual({ cooldownMs: 1000, bulletSpeed: 650, damage: 1, range: 320, pellets: 6, spreadDeg: 36 });
    expect(WEAPON_PRESETS.piercing).toEqual({ cooldownMs: 600, bulletSpeed: 800, damage: 2, range: 800, pierce: 2 });
  });

  it('every combination of the new words compiles to a level that passes the schema', () => {
    for (const weapon of ['shotgun', 'piercing'] as const) for (const healthDrops of HEALTH_DROPS) for (const map of SHOOTER_MAPS) {
      for (const enemies of [[{ type: 'spitter', share: 5 }], [{ type: 'runner', share: 3 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 3 }, { type: 'spitter', share: 2 }]]) {
        const level = compileShooter(brief({ weapon, healthDrops, map, enemies, intensity: 4 }), 11).level;
        expect(ShooterLevelSchema.safeParse(level).success, `${weapon} ${healthDrops} ${map}`).toBe(true);
      }
    }
  });
});

describe('the wave schedule with spitters', () => {
  const horizon = (b: ShooterBrief) => (b.goal.type === 'survive' ? b.goal.seconds : 0) * 1000;

  it('weighs a spitter 4 and holds it back for the first 20% of the game when there are other kinds', () => {
    expect(ENEMY_WEIGHT.spitter).toBe(4);
    expect(SPITTER_NOT_BEFORE).toBe(0.2);
    for (let seed = 1; seed <= 12; seed += 1) {
      const b = brief({ enemies: [{ type: 'runner', share: 4 }, { type: 'spitter', share: 6 }], goal: { type: 'survive', seconds: 100 } });
      const { waves } = scheduleWaves(b, deriveRng(seed, 0x5741));
      const first = Math.min(...waves.filter((w) => w.type === 'spitter').map((w) => w.atMs));
      expect(first, `seed ${seed}`).toBeGreaterThanOrEqual(horizon(b) * SPITTER_NOT_BEFORE);
    }
  });

  it('a spitter that is the only kind may come at once', () => {
    const b = brief({ enemies: [{ type: 'spitter', share: 5 }], goal: { type: 'survive', seconds: 100 } });
    const { waves } = scheduleWaves(b, deriveRng(1, 0x5741));
    expect(Math.min(...waves.map((w) => w.atMs))).toBeLessThan(horizon(b) * SPITTER_NOT_BEFORE);
    expect(new Set(waves.map((w) => w.type))).toEqual(new Set(['spitter']));
  });

  it('a brute still waits for 25%, with or without a spitter', () => {
    const b = brief({ enemies: [{ type: 'brute', share: 3 }, { type: 'spitter', share: 3 }, { type: 'runner', share: 4 }], goal: { type: 'survive', seconds: 100 } });
    const { waves } = scheduleWaves(b, deriveRng(2, 0x5741));
    expect(Math.min(...waves.filter((w) => w.type === 'brute').map((w) => w.atMs))).toBeGreaterThanOrEqual(horizon(b) * BRUTE_NOT_BEFORE);
  });

  it('the schedule follows the shares and stays inside the level limits', () => {
    for (const intensity of [1, 3, 5]) {
      const b = brief({ intensity, enemies: [{ type: 'runner', share: 3 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 3 }, { type: 'spitter', share: 2 }] });
      const { waves } = scheduleWaves(b, deriveRng(5, 0x5741));
      const total = waves.reduce((s, w) => s + w.count, 0);
      const of = (type: string) => waves.filter((w) => w.type === type).reduce((s, w) => s + w.count, 0);
      expect(of('spitter') / total).toBeGreaterThan(0.1);
      expect(of('spitter') / total).toBeLessThan(0.3);
      expect(waves.length).toBeLessThanOrEqual(30);
      expect(waves.every((w) => w.count <= 40)).toBe(true);
    }
  });

  it('a brief WITHOUT a spitter gets exactly the schedule it got before Stage 4B (525 schedules, digest of the Stage 4A code)', () => {
    const MIXES = [[{ type: 'runner', share: 5 }], [{ type: 'brute', share: 5 }], [{ type: 'swarmer', share: 5 }],
      [{ type: 'runner', share: 4 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 4 }], [{ type: 'brute', share: 6 }, { type: 'swarmer', share: 4 }]];
    const GOALS = [{ type: 'survive', seconds: 20 }, { type: 'survive', seconds: 60 }, { type: 'survive', seconds: 180 },
      { type: 'kill', count: 10 }, { type: 'kill', count: 40 }, { type: 'kill', count: 100 }, { type: 'kill', count: 200 }];
    let text = '';
    let count = 0;
    for (const intensity of [1, 2, 3, 4, 5]) for (const enemies of MIXES) for (const goal of GOALS) for (const seed of [1, 2, 3]) {
      text += JSON.stringify(scheduleWaves(brief({ intensity, enemies, goal }), deriveRng(seed, 0x5741)));
      count += 1;
    }
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
    expect(count).toBe(525);
    // computed from the Stage 4A waves.ts (git HEAD ec5b7a7) before it was changed; equal to the new code's output
    expect(hash.toString(16)).toBe('a4aa7b68');
  });
});

describe('what the model is told', () => {
  const text = SHOOTER_BRIEF_SYSTEM_PROMPT;
  it('describes the four enemy kinds, five weapons and healthDrops, from the same lists as the schema', () => {
    const lines = describeBrief().join('\n');
    expect(lines).toContain('enemies: 1-4 items, each {type: runner|brute|swarmer|spitter');
    expect(lines).toContain('weapon: pistol|rapid|heavy|shotgun|piercing');
    expect(lines).toContain('healthDrops: none|some|many');
    expect(text).toContain(lines);
  });
  it('explains the spitter, the two weapons and when to use healthDrops', () => {
    expect(text).toContain('spitter ranged: stands back and shoots slow bullets');
    for (const word of ['archers', 'snipers', 'turrets']) expect(text).toContain(word);
    expect(text).toMatch(/shotgun for a shotgun/);
    expect(text).toMatch(/piercing for bullets that pass through enemies \(sniper/);
    expect(text).toMatch(/healthDrops: none by default; some when the user asks for health pickups/);
    expect(text).toMatch(/many when the user says many/);
    expect(text).not.toMatch(/heavy for slow powerful shots \([^)]*shotgun/);
  });
  it('no longer lists health pickups as unsupported, but still power-ups and now explosions', () => {
    expect(text).not.toMatch(/health pickups, power-ups/);
    expect(text).toContain('power-ups or upgrades other than health drops');
    expect(text).toContain('explosions or area damage (rockets, grenades)');
  });
  it('the provider schema asks for healthDrops and up to four enemies', () => {
    const schema = JSON.stringify(briefJsonSchema());
    expect(schema).toContain('healthDrops');
    expect(schema).toContain('spitter');
    expect(schema).toContain('piercing');
  });
});
