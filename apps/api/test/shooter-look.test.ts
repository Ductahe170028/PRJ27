import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHOOTER_LEVELS, ShooterLevelSchema, createSim, snapshotHash, step } from '@game-creator/contracts';
import { ENEMY_FAMILIES, SHOOTER_THEMES, ShooterBriefSchema, WEAPONS, normalizeBrief, type ShooterBrief } from '../src/shooter/brief.js';
import { compileShooter } from '../src/shooter/compile.js';
import { LOOK_OPTIONS, pickLook } from '../src/shooter/look.js';
import { guardUnrequested } from '../src/shooter/notices.js';
import { SHOOTER_BRIEF_SYSTEM_PROMPT, describeBrief } from '../src/shooter/prompt.js';

// The packs drawn by code live in apps/web; this test only needs their ids, so it loads that file by address (it is not a dependency of the API).
const registry = (await import(new URL('../../web/src/game/art/registry.ts', import.meta.url).href)) as {
  PROCEDURAL_PACKS: Record<string, Record<string, unknown>>; proceduralIds(kind: string): string[];
};
const { PROCEDURAL_PACKS, proceduralIds } = registry;

const brief = (patch: Partial<ShooterBrief> = {}): ShooterBrief => ShooterBriefSchema.parse({
  version: 'brief-1', healthDrops: 'none', boss: 'none', base: 'none', enemyFamily: 'auto', title: 'Look', theme: 'zombie-city', map: 'open-arena',
  enemies: [{ type: 'runner', share: 5 }], intensity: 2, playerHealth: 'normal', weapon: 'pistol', goal: { type: 'survive', seconds: 60 }, unsupported: [], ...patch,
});
const seeds = Array.from({ length: 1000 }, (_, i) => i * 7919 + 13);

describe('the family of enemies in a brief', () => {
  it('is one of auto, bug, mutant, robot, and a brief without it fails the schema', () => {
    expect([...ENEMY_FAMILIES]).toEqual(['auto', 'bug', 'mutant', 'robot']);
    const { enemyFamily: _gone, ...without } = brief();
    expect(ShooterBriefSchema.safeParse(without).success).toBe(false);
  });

  it('is filled with auto when the model left it out, and a wrong value is left for the schema to refuse', () => {
    const raw = { ...brief() } as Record<string, unknown>;
    delete raw.enemyFamily;
    const filled = normalizeBrief(raw) as Record<string, unknown>;
    expect(filled.enemyFamily).toBe('auto');
    expect(ShooterBriefSchema.safeParse(filled).success).toBe(true);
    for (const wrong of ['dragon', null, 3, 'Bug', '']) {
      const normalized = normalizeBrief({ ...raw, enemyFamily: wrong });
      expect(ShooterBriefSchema.safeParse(normalized).success, String(wrong)).toBe(false);
    }
    expect((normalizeBrief({ ...raw, enemyFamily: 'robot' }) as Record<string, unknown>).enemyFamily).toBe('robot');
  });

  it('is not touched by the guard (it only changes how things look, not how the game plays)', () => {
    for (const family of ENEMY_FAMILIES) {
      const { brief: guarded, removed } = guardUnrequested({ healthDrops: 'some', base: 'defend', enemyFamily: family }, 'một màn bắn súng');
      expect(guarded.enemyFamily).toBe(family);
      expect(removed).toEqual(['healthDrops', 'base']);
    }
  });

  it('is described to the model in one line, with what each family means', () => {
    expect(describeBrief()).toContain('enemyFamily: auto|bug|mutant|robot');
    expect(SHOOTER_BRIEF_SYSTEM_PROMPT).toContain('enemyFamily: auto|bug|mutant|robot (look only)');
    expect(SHOOTER_BRIEF_SYSTEM_PROMPT).toContain('bug = insects, aliens, spiders; mutant = zombies, monsters, undead, slimes; robot = machines, drones, cyborgs; auto when the user does not say.');
    // the model is asked for no other look field: hero, gun and base are the engine's to choose
    for (const word of ['hero', 'look:']) expect(describeBrief().join('\n')).not.toContain(word);
  });
});

describe('pickLook: how a compiled level looks', () => {
  it('is the same for the same brief and seed, and has the five parts', () => {
    for (const seed of seeds.slice(0, 50)) expect(pickLook(brief(), seed)).toEqual(pickLook(brief(), seed));
    const look = pickLook(brief({ theme: 'ice-base', weapon: 'shotgun' }), 12345);
    expect(Object.keys(look).sort()).toEqual(['base', 'biome', 'family', 'hero', 'weapon']);
    expect(look.biome).toBe('ice-base');
    expect(look.weapon).toBe('shotgun');
  });

  it('takes the scenery from the theme and the gun from the weapon, for every theme and weapon', () => {
    for (const theme of SHOOTER_THEMES) expect(pickLook(brief({ theme }), 77).biome).toBe(theme);
    for (const weapon of WEAPONS) expect(LOOK_OPTIONS.weapon[weapon]).toContain(pickLook(brief({ weapon }), 77).weapon);
  });

  it('keeps the family the user named, whatever the seed', () => {
    for (const family of ['bug', 'mutant', 'robot'] as const) for (const seed of seeds.slice(0, 200)) expect(pickLook(brief({ enemyFamily: family }), seed).family).toBe(family);
  });

  it('uses every hero, base and (when auto) family over 1000 seeds, and none of two gets under 25%', () => {
    const count = (pick: (seed: number) => string) => {
      const counts = new Map<string, number>();
      for (const seed of seeds) counts.set(pick(seed), (counts.get(pick(seed)) ?? 0) + 1);
      return counts;
    };
    const heroes = count((seed) => pickLook(brief(), seed).hero);
    const bases = count((seed) => pickLook(brief(), seed).base);
    const families = count((seed) => pickLook(brief(), seed).family);
    expect([...heroes.keys()].sort()).toEqual([...LOOK_OPTIONS.hero].sort());
    expect([...bases.keys()].sort()).toEqual([...LOOK_OPTIONS.base].sort());
    expect([...families.keys()].sort()).toEqual([...LOOK_OPTIONS.family].sort());
    for (const counts of [heroes, bases]) for (const n of counts.values()) expect(n).toBeGreaterThanOrEqual(250);
    for (const n of families.values()) expect(n).toBeGreaterThanOrEqual(200);
  });

  it('chooses the parts independently of each other', () => {
    const pairs = new Set(seeds.map((seed) => { const look = pickLook(brief(), seed); return `${look.hero}/${look.base}/${look.family}`; }));
    expect(pairs.size).toBe(LOOK_OPTIONS.hero.length * LOOK_OPTIONS.base.length * LOOK_OPTIONS.family.length);
  });
});

describe('a compiled level carries its look', () => {
  it('has a look that passes the level schema, the same one pickLook gives for its seed', () => {
    for (const [i, theme] of SHOOTER_THEMES.entries()) {
      const b = brief({ theme, enemyFamily: ENEMY_FAMILIES[i % 4]!, weapon: WEAPONS[i % 5]! });
      const { level } = compileShooter(b, 4000 + i * 31);
      expect(ShooterLevelSchema.safeParse(level).success).toBe(true);
      expect(level.look).toEqual(pickLook(b, level.seed));
    }
  });

  it('does not change how the game plays: the simulation hash is the same with and without the look', () => {
    const { level } = compileShooter(brief({ base: 'defend', boss: 'crusher' }), 2024);
    const { look: _look, ...bare } = level;
    expect(level.look).toBeDefined();
    const a = createSim(structuredClone(level));
    const b = createSim(structuredClone(bare));
    expect(snapshotHash(a)).toBe(snapshotHash(b));
    for (let tick = 0; tick < 600; tick += 1) {
      const input = { moveX: (tick % 120 < 60 ? 1 : -1) as 1 | -1, moveY: 0 as const, aimX: 700, aimY: 300, fire: tick % 7 < 3 };
      step(a, input);
      step(b, input);
    }
    expect(snapshotHash(a)).toBe(snapshotHash(b));
    // and the look is not in what the hash was made from: another look, the same hash
    const other = { ...level, look: { biome: 'ice-base', hero: 'armor', family: 'robot', base: 'outpost', weapon: 'heavy' } };
    expect(snapshotHash(createSim(structuredClone(other)))).toBe(snapshotHash(createSim(structuredClone(level))));
  });

  it('a level with no look (every hand-made level, every saved level) is still a valid level', () => {
    for (const [name, level] of Object.entries(SHOOTER_LEVELS)) {
      if (name.startsWith('art-')) continue;
      expect('look' in level, name).toBe(false);
      expect(ShooterLevelSchema.safeParse(level).success, name).toBe(true);
    }
  });

  it('refuses a look with a strange id or an extra field', () => {
    const { level } = compileShooter(brief(), 5);
    const bad = (look: unknown) => ShooterLevelSchema.safeParse({ ...level, look }).success;
    expect(bad({ ...level.look, hero: 'Armor' })).toBe(false);
    expect(bad({ ...level.look, hero: 'x'.repeat(31) })).toBe(false);
    expect(bad({ ...level.look, extra: 'x' })).toBe(false);
    const { hero: _hero, ...partial } = level.look!;
    expect(bad(partial)).toBe(false);
    expect(bad(level.look)).toBe(true);
  });
});

describe('the ids that pickLook can give all have a pack (and no pack is left without a reason)', () => {
  const webRoot = new URL('../../web/public/art/', import.meta.url);
  const pngIds = (kind: string) => {
    const index = JSON.parse(readFileSync(new URL('index.json', webRoot), 'utf8')) as Array<{ kind: string; id: string }>;
    return index.filter((entry) => entry.kind === kind).map((entry) => entry.id);
  };
  const hasPack = (kind: 'biome' | 'hero' | 'family' | 'base' | 'weapon', id: string) => proceduralIds(kind).includes(id) || pngIds(kind).includes(id);

  it('every id of LOOK_OPTIONS has a pack, PNG or drawn by code', () => {
    for (const id of LOOK_OPTIONS.hero) expect(hasPack('hero', id), `hero ${id}`).toBe(true);
    for (const id of LOOK_OPTIONS.family) expect(hasPack('family', id), `family ${id}`).toBe(true);
    for (const id of LOOK_OPTIONS.base) expect(hasPack('base', id), `base ${id}`).toBe(true);
    for (const weapon of WEAPONS) for (const id of LOOK_OPTIONS.weapon[weapon]) expect(hasPack('weapon', id), `weapon ${id}`).toBe(true);
    for (const theme of SHOOTER_THEMES) expect(hasPack('biome', theme), `biome ${theme}`).toBe(true);
  });

  it('every pack drawn by code is chosen by something: a theme, LOOK_OPTIONS, or it is the fixed pickup/effects pack', () => {
    expect(proceduralIds('biome').sort()).toEqual([...SHOOTER_THEMES].sort());
    expect(proceduralIds('hero').sort()).toEqual([...LOOK_OPTIONS.hero].sort());
    expect(proceduralIds('family').sort()).toEqual([...LOOK_OPTIONS.family].sort());
    expect(proceduralIds('base').sort()).toEqual([...LOOK_OPTIONS.base].sort());
    expect(proceduralIds('weapon').sort()).toEqual(Object.values(LOOK_OPTIONS.weapon).flat().sort());
    expect(proceduralIds('pickup')).toEqual(['health']);
    expect(proceduralIds('fx')).toEqual(['basic']);
    expect(Object.keys(PROCEDURAL_PACKS).sort()).toEqual(['base', 'biome', 'family', 'fx', 'hero', 'pickup', 'weapon']);
  });

  it('LOOK_OPTIONS has at least 2 heroes, 3 families, 2 bases and a gun for each weapon', () => {
    expect(LOOK_OPTIONS.hero.length).toBeGreaterThanOrEqual(2);
    expect(LOOK_OPTIONS.family.slice().sort()).toEqual(['bug', 'mutant', 'robot']);
    expect(LOOK_OPTIONS.base.length).toBeGreaterThanOrEqual(2);
    for (const weapon of WEAPONS) expect(LOOK_OPTIONS.weapon[weapon].length).toBeGreaterThanOrEqual(1);
  });

  it('public/art/index.json matches the folders: every entry has a folder, a valid manifest and a sheet, and every folder is listed', async () => {
    const { ManifestSchema } = await import('@game-creator/contracts');
    const index = JSON.parse(readFileSync(new URL('index.json', webRoot), 'utf8')) as Array<{ kind: string; id: string }>;
    const listed = index.map((entry) => `${entry.kind}/${entry.id}`).sort();
    expect(new Set(listed).size).toBe(listed.length);
    const folders: string[] = [];
    for (const kind of readdirSync(webRoot)) {
      if (!statSync(new URL(`${kind}/`, webRoot)).isDirectory()) continue;
      for (const id of readdirSync(new URL(`${kind}/`, webRoot))) if (statSync(new URL(`${kind}/${id}/`, webRoot)).isDirectory()) folders.push(`${kind}/${id}`);
    }
    expect(folders.sort()).toEqual(listed);
    for (const entry of index) {
      const folder = new URL(`${entry.kind}/${entry.id}/`, webRoot);
      const manifest = ManifestSchema.parse(JSON.parse(readFileSync(new URL('manifest.json', folder), 'utf8')));
      expect({ kind: manifest.kind, id: manifest.id }).toEqual(entry);
      expect(manifest.source).toBe('png');
      expect(statSync(new URL(manifest.sheet!, folder)).size).toBeGreaterThan(0);
    }
  });
});
