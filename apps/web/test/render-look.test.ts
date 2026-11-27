import { describe, expect, it } from 'vitest';
import { SHOOTER_LEVELS, type Look } from '@game-creator/contracts';
import { BIOME_BACKGROUNDS, DEFAULT_IDS, applyLookOverrides, effectiveLook, lookText, nearestBiome, weaponIdFor } from '../src/game/render/look';
import { hasOverrides, variantFromParams, withBoss, withCrowd, type KnownIds } from '../src/lib/shooter-variants';

const KNOWN: KnownIds = {
  biome: Object.keys(BIOME_BACKGROUNDS), hero: ['scout', 'armor', 'grunt-test'], family: ['bug', 'mutant', 'robot'],
  base: ['bunker', 'outpost'], weapon: ['pistol', 'rapid', 'heavy', 'shotgun', 'piercing'],
};
const weapon = (patch: Record<string, number>) => ({ cooldownMs: 300, bulletSpeed: 600, damage: 1, range: 600, ...patch });

describe('the look of a level with none', () => {
  it('picks the scenery whose ground color is nearest (an exact color wins)', () => {
    for (const [id, background] of Object.entries(BIOME_BACKGROUNDS)) expect(nearestBiome(background)).toBe(id);
    expect(nearestBiome('#131a22')).toBe('zombie-city');
    expect(nearestBiome('#2b2015')).toBe('desert-ruins');
    expect(nearestBiome('#152229')).toBe('hospital');
  });

  it('works out the held gun from the weapon numbers', () => {
    expect(weaponIdFor(weapon({ pellets: 6, spreadDeg: 36 }))).toBe('shotgun');
    expect(weaponIdFor(weapon({ pierce: 2 }))).toBe('piercing');
    expect(weaponIdFor(weapon({ cooldownMs: 150 }))).toBe('rapid');
    expect(weaponIdFor(weapon({ damage: 3 }))).toBe('heavy');
    expect(weaponIdFor(weapon({}))).toBe('pistol');
    expect(weaponIdFor(weapon({ pellets: 1 }))).toBe('pistol');
    // pellets win over the others, as the list in the specification goes
    expect(weaponIdFor(weapon({ pellets: 6, pierce: 2, cooldownMs: 100 }))).toBe('shotgun');
  });

  it('uses the first hero, base and family, and the level\'s own look when it has one', () => {
    const look = effectiveLook(SHOOTER_LEVELS.arena);
    expect(look.hero).toBe(DEFAULT_IDS.hero);
    expect(look.base).toBe(DEFAULT_IDS.base);
    expect(look.family).toBe(DEFAULT_IDS.family);
    expect(look.weapon).toBe('pistol');
    expect(effectiveLook(SHOOTER_LEVELS['shotgun-pit']).weapon).toBe('shotgun');
    const own: Look = { biome: 'ice-base', hero: 'armor', family: 'robot', base: 'outpost', weapon: 'heavy' };
    expect(effectiveLook({ ...SHOOTER_LEVELS.arena, look: own })).toEqual(own);
  });

  it('writes the look as one sentence for the hidden HUD', () => {
    expect(lookText({ biome: 'ice-base', hero: 'armor', family: 'robot', base: 'outpost', weapon: 'shotgun' })).toBe('biome:ice-base;hero:armor;family:robot;base:outpost;weapon:shotgun');
  });
});

describe('overrides from the playground address', () => {
  const base: Look = { biome: 'zombie-city', hero: 'scout', family: 'bug', base: 'bunker', weapon: 'pistol' };

  it('takes known ids and ignores the others', () => {
    const params = new URLSearchParams('shooter=x&biome=ice-base&hero=armor&family=robot&base=outpost&weapon=shotgun');
    expect(applyLookOverrides(base, params, KNOWN)).toEqual({ biome: 'ice-base', hero: 'armor', family: 'robot', base: 'outpost', weapon: 'shotgun' });
    const odd = new URLSearchParams('biome=moon&hero=&family=%3Cscript%3E&weapon=rocket&base=bunker');
    expect(applyLookOverrides(base, odd, KNOWN)).toEqual(base);
  });

  it('knows when the address changes anything', () => {
    expect(hasOverrides(new URLSearchParams('shooter=arena'))).toBe(false);
    expect(hasOverrides(new URLSearchParams('shooter=arena&boss=crusher'))).toBe(true);
    expect(hasOverrides(new URLSearchParams('shooter=arena&stress=120'))).toBe(true);
    expect(hasOverrides(new URLSearchParams('shooter=arena&hero=armor'))).toBe(true);
  });
});

describe('what the playground can add to a level', () => {
  const level = SHOOTER_LEVELS['art-showcase'];

  it('adds a boss at 6 s and makes it the goal; an unknown boss or a level that has one is left alone', () => {
    const crusher = withBoss(level, 'crusher');
    expect(crusher.waves.filter((w) => w.type === 'crusher')).toHaveLength(1);
    expect(crusher.win).toEqual({ type: 'boss' });
    expect(withBoss(level, 'dragon')).toBe(level);
    expect(withBoss(crusher, 'gunner')).toBe(crusher);
    expect(withBoss(level, 'gunner').waves.some((w) => w.type === 'gunner')).toBe(true);
  });

  it('fills a level with a crowd of the number asked for (4 to 400)', () => {
    const total = (l: typeof level) => l.waves.reduce((n, w) => n + w.count, 0);
    expect(total(withCrowd(level, 120))).toBe(120);
    expect(total(withCrowd(level, 2))).toBe(4);
    expect(total(withCrowd(level, 5000))).toBe(400);
    expect(withCrowd(level, 120).waves.length).toBeLessThanOrEqual(30);
  });

  it('builds the level from an address and gives it a look, with everything it asks for', () => {
    const params = new URLSearchParams('shooter=art-showcase&boss=gunner&hero=armor&stress=60&biome=desert-ruins');
    const next = variantFromParams(level, params, KNOWN);
    expect(next.look).toMatchObject({ biome: 'desert-ruins', hero: 'armor' });
    expect(next.waves.some((w) => w.type === 'gunner')).toBe(true);
    expect(next.win).toEqual({ type: 'boss' });
  });

  it('has the two Stage 5A levels, and the one with the PNG hero looks like that', () => {
    expect(SHOOTER_LEVELS['art-showcase'].look).toBeDefined();
    expect(SHOOTER_LEVELS['art-test'].look!.hero).toBe('grunt-test');
    const kinds = new Set(SHOOTER_LEVELS['art-showcase'].waves.map((w) => w.type));
    for (const type of ['runner', 'brute', 'swarmer', 'spitter']) expect(kinds.has(type as 'runner')).toBe(true);
    expect(SHOOTER_LEVELS['art-showcase'].base).toBeDefined();
  });
});
