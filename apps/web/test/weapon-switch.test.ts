import { describe, expect, it } from 'vitest';
import { SHOOTER_LEVELS, ManifestSchema } from '@game-creator/contracts';
import { manifestFits } from '../src/game/art/manifest';
import { neededRefs } from '../src/game/art/refs';
import { WEAPON_PACKS } from '../src/game/art/procedural/weapons';
import {
  ARSENAL_HINT, BANNER_HINT, BASE_BAR_PLATE, BOSS_BAR_PLATE, HUD_STRIP_HEIGHT, WEAPON_CELL, WEAPON_GAP, WHEEL_NOTCH, arsenalLines, boxesOverlap, levelInfo, slotForKey,
  WEAPON_TEXT, waitShare, weaponBarLayout, weaponBlurb, weaponName, wheelStep, wrapSlot,
} from '../src/lib/shooter-text';
import { variantFromParams } from '../src/lib/shooter-variants';

const LEVEL = SHOOTER_LEVELS.arsenal;

describe('the keys that switch weapons', () => {
  it('takes 1 to 5 on the digit row and on the number pad', () => {
    for (let n = 1; n <= 5; n += 1) {
      expect(slotForKey(`Digit${n}`, 5)).toBe(n - 1);
      expect(slotForKey(`Numpad${n}`, 5)).toBe(n - 1);
    }
  });

  it('takes nothing else: 0, 6 to 9, letters, arrows, and a slot the arsenal does not have', () => {
    for (const code of ['Digit0', 'Digit6', 'Digit9', 'Numpad0', 'Numpad6', 'KeyW', 'KeyR', 'Space', 'ArrowUp', 'NumpadAdd', 'Digit', '', 'Digit10']) expect(slotForKey(code, 5), code).toBeUndefined();
    expect(slotForKey('Digit3', 2)).toBeUndefined(); // an arsenal of two has no third slot
    expect(slotForKey('Digit2', 2)).toBe(1);
  });

  it('goes round the weapons with the wheel: forward from the last is the first, back from the first is the last', () => {
    expect(wrapSlot(0, 1, 5)).toBe(1);
    expect(wrapSlot(4, 1, 5)).toBe(0);
    expect(wrapSlot(0, -1, 5)).toBe(4);
    expect(wrapSlot(2, -1, 5)).toBe(1);
    expect(wrapSlot(1, 1, 2)).toBe(0);
    expect(wrapSlot(3, 12, 5)).toBe(0);
  });

  it('gives one step per notch of the wheel and keeps the rest, so that a trackpad does not race through the weapons', () => {
    expect(wheelStep(0, 100)).toEqual({ step: 1, rest: 100 - WHEEL_NOTCH });
    expect(wheelStep(0, -100)).toEqual({ step: -1, rest: WHEEL_NOTCH - 100 });
    expect(wheelStep(130, 100)).toEqual({ step: 1, rest: WHEEL_NOTCH - 1 }); // stored steps are capped
    expect(wheelStep(-130, -100)).toEqual({ step: -1, rest: 1 - WHEEL_NOTCH });
    expect(wheelStep(0, 10)).toEqual({ step: 0, rest: 10 });
    let stored = 0;
    let steps = 0;
    for (let i = 0; i < 30; i += 1) { const r = wheelStep(stored, 4); stored = r.rest; steps += r.step; } // a gentle trackpad: 120 in all
    expect(steps).toBe(2);
    expect(wheelStep(0, Number.NaN)).toEqual({ step: 0, rest: 0 });
    expect(wheelStep(30, 40).step).toBe(1);
  });
});

describe('the bar of weapons', () => {
  it('has one cell per weapon, 40 x 40, centered along the bottom of the field', () => {
    for (const count of [2, 3, 5]) {
      const layout = weaponBarLayout(count);
      expect(layout.cells).toHaveLength(count);
      expect(layout.cells.map((cell) => cell.key)).toEqual(Array.from({ length: count }, (_, i) => String(i + 1)));
      const width = count * WEAPON_CELL + (count - 1) * WEAPON_GAP;
      expect(layout.cells[0]!.x).toBe(Math.round(480 - width / 2));
      expect(layout.cells.at(-1)!.x + WEAPON_CELL).toBe(layout.cells[0]!.x + width);
      expect(layout.plate.y + layout.plate.height).toBeLessThanOrEqual(540);
      expect(layout.plate.x).toBeGreaterThan(0);
      expect(layout.plate.x + layout.plate.width).toBeLessThan(960);
    }
  });

  it('never overlaps the HUD strip, the boss bar or the base bar', () => {
    const plate = weaponBarLayout(5).plate;
    const box = { x: plate.x, y: plate.y, width: plate.width, height: plate.height };
    expect(plate.y).toBeGreaterThanOrEqual(HUD_STRIP_HEIGHT);
    expect(boxesOverlap(box, BOSS_BAR_PLATE)).toBe(false);
    expect(boxesOverlap(box, BASE_BAR_PLATE)).toBe(false);
    expect(boxesOverlap(box, { x: 0, y: 0, width: 960, height: HUD_STRIP_HEIGHT })).toBe(false);
  });

  it('says how much of the wait is left: the longer of the shot clock and the switch, over the longer of the cooldown and the switch', () => {
    expect(waitShare(100, 100, 0, 36, 18)).toBe(0); // ready
    expect(waitShare(100, 136, 0, 36, 18)).toBe(1); // the heavy has just fired
    expect(waitShare(118, 136, 0, 36, 18)).toBe(0.5);
    expect(waitShare(100, 90, 118, 9, 18)).toBe(1); // switching to a quick weapon: the switch is the wait
    expect(waitShare(109, 90, 118, 9, 18)).toBe(0.5);
    expect(waitShare(100, 100 + 99, 0, 36, 18)).toBe(1); // never above 1
    expect(waitShare(500, 10, 10, 0, 0)).toBe(0);
  });
});

describe('what the screen says about the arsenal', () => {
  it('has one table of names and plain sentences for the five weapons, in the order of the keys, and gives an unknown id back as it is', () => {
    const ids = ['pistol', 'shotgun', 'piercing', 'rapid', 'heavy'];
    expect(ids.map(weaponName)).toEqual(['Súng ngắn', 'Shotgun (súng săn)', 'Súng xuyên giáp', 'Súng bắn nhanh (liên thanh)', 'Súng nặng']);
    expect(Object.keys(WEAPON_TEXT)).toEqual(ids);
    expect(weaponBlurb('pistol')).toBe('Bắn từng phát, tầm xa vừa');
    expect(weaponBlurb('rapid')).toBe('Bắn liên tục, mỗi viên yếu');
    expect(weaponBlurb('heavy')).toBe('Chậm nhưng mỗi viên rất mạnh');
    expect(weaponName('grunt-gun')).toBe('grunt-gun');
    expect(weaponBlurb('grunt-gun')).toBe('');
  });

  it('takes the numbers of the sentences from the weapon\'s own data, so that a level that changes them still reads true', () => {
    const shotgun = LEVEL.arsenal![1]!.weapon;
    expect(weaponBlurb('shotgun', shotgun)).toBe(`Bắn chùm ${shotgun.pellets} viên, rất mạnh ở gần`);
    expect(weaponBlurb('shotgun', { ...shotgun, pellets: 9 })).toBe('Bắn chùm 9 viên, rất mạnh ở gần');
    const piercing = LEVEL.arsenal![2]!.weapon;
    expect(weaponBlurb('piercing', piercing)).toBe(`Đạn xuyên qua ${piercing.pierce} quái`);
    expect(weaponBlurb('piercing', { ...piercing, pierce: 4 })).toBe('Đạn xuyên qua 4 quái');
  });

  it('lists all five weapons on the card with their key, name and sentence, then the one the player starts with, only for a level that has an arsenal', () => {
    expect(arsenalLines(LEVEL)).toEqual([
      'Có 5 súng, đổi bằng phím 1–5 hoặc cuộn chuột:',
      '1 · Súng ngắn: Bắn từng phát, tầm xa vừa',
      '2 · Shotgun (súng săn): Bắn chùm 6 viên, rất mạnh ở gần',
      '3 · Súng xuyên giáp: Đạn xuyên qua 2 quái',
      '4 · Súng bắn nhanh (liên thanh): Bắn liên tục, mỗi viên yếu',
      '5 · Súng nặng: Chậm nhưng mỗi viên rất mạnh',
      'Súng lúc đầu: Súng ngắn',
    ]);
    expect(levelInfo(LEVEL).arsenal).toEqual(arsenalLines(LEVEL));
    const rapidStart = { ...LEVEL, weapon: LEVEL.arsenal![3]!.weapon };
    expect(arsenalLines(rapidStart).at(-1)).toBe('Súng lúc đầu: Súng bắn nhanh (liên thanh)');
    expect(arsenalLines(SHOOTER_LEVELS.arena)).toEqual([]);
    expect('arsenal' in levelInfo(SHOOTER_LEVELS.arena)).toBe(false);
  });

  it('keeps the old banner sentence, and has a separate hint for switching', () => {
    expect(BANNER_HINT).toBe('WASD di chuyển · chuột ngắm và bắn · R chơi lại');
    expect(ARSENAL_HINT).toBe('1–5 hoặc cuộn chuột: đổi súng');
  });
});

describe('the level that shows it, and the pictures it needs', () => {
  it('is a hand-made level with all five weapons, starting with the pistol, a brute and spitters, for 90 seconds', () => {
    expect(LEVEL.arsenal!.map((entry) => entry.id)).toEqual(['pistol', 'shotgun', 'piercing', 'rapid', 'heavy']);
    expect(LEVEL.weapon).toEqual(LEVEL.arsenal![0]!.weapon);
    const kinds = new Set(LEVEL.waves.map((wave) => wave.type));
    expect(kinds.has('brute') && kinds.has('spitter')).toBe(true);
    expect(LEVEL.win).toEqual({ type: 'survive', seconds: 90 });
    for (const [name, level] of Object.entries(SHOOTER_LEVELS)) expect('arsenal' in level, name).toBe(name === 'arsenal');
  });

  it('&loadout=single takes the arsenal away and leaves the starting weapon; a level without one is left as it is', () => {
    const known = { biome: ['zombie-city'], hero: ['scout'], family: ['bug'], base: ['bunker'], weapon: ['pistol'] };
    const single = variantFromParams(LEVEL, new URLSearchParams('shooter=arsenal&loadout=single'), known);
    expect('arsenal' in single).toBe(false);
    expect(single.weapon).toEqual(LEVEL.weapon);
    expect(variantFromParams(LEVEL, new URLSearchParams('shooter=arsenal'), known).arsenal).toHaveLength(5);
    expect(variantFromParams(LEVEL, new URLSearchParams('loadout=all'), known).arsenal).toHaveLength(5);
    expect('arsenal' in variantFromParams(SHOOTER_LEVELS.arena, new URLSearchParams('loadout=single'), known)).toBe(false);
  });

  it('fetches the weapon pack of every weapon in the arsenal, once each, besides the look\'s own', () => {
    const look = { biome: 'zombie-city', hero: 'scout', family: 'bug', base: 'bunker', weapon: 'pistol' };
    const ids = LEVEL.arsenal!.map((entry) => entry.id);
    const weapons = neededRefs(look, ids).filter((ref) => ref.kind === 'weapon').map((ref) => ref.id);
    expect(weapons.sort()).toEqual([...ids].sort());
    expect(neededRefs(look).filter((ref) => ref.kind === 'weapon')).toHaveLength(1);
    expect(neededRefs({ ...look, weapon: 'shotgun' }, ids).filter((ref) => ref.kind === 'weapon')).toHaveLength(5); // the shotgun is the look's own pack, so only the other four are added by id
  });

  it('has an icon for each of the five weapons in the packs drawn by code, inside the sheet (and the manifest accepts "icon")', () => {
    for (const id of ['pistol', 'shotgun', 'piercing', 'rapid', 'heavy']) {
      const pack = WEAPON_PACKS[id]!;
      expect(pack.manifest.icon, id).toBeTypeOf('number');
      expect(manifestFits(pack.manifest, pack.width, pack.height), id).toBe(true);
    }
    const base = { version: 1, kind: 'weapon', id: 'w', source: 'procedural', license: 'procedural', author: '', origin: '', frame: { w: 32, h: 32 }, columns: 4, animations: { idle: { frames: [0], fps: 1, loop: true } }, muzzle: { x: 30, y: 16 }, bullet: { style: 'dot', color: '#ffffff' } };
    expect(ManifestSchema.safeParse({ ...base, icon: 2 }).success).toBe(true);
    expect(ManifestSchema.safeParse({ ...base, icon: -1 }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...base, icon: 1.5 }).success).toBe(false);
    expect(ManifestSchema.safeParse(base).success).toBe(true);
    // an icon frame that is outside the sheet is caught
    expect(manifestFits(ManifestSchema.parse({ ...base, icon: 9 }), 128, 32)).toBe(false);
    expect(manifestFits(ManifestSchema.parse({ ...base, icon: 3 }), 128, 32)).toBe(true);
  });
});
