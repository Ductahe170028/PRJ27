import { describe, expect, it } from 'vitest';
import { normalizeBrief, ShooterBriefSchema } from '../src/shooter/brief.js';
import { SHOOTER_BRIEF_SYSTEM_PROMPT, briefJsonSchema, describeBrief } from '../src/shooter/prompt.js';
import { THEMES } from '../src/shooter/presets.js';

const valid = () => ({
  version: 'brief-1', healthDrops: 'none', boss: 'none', base: 'none', enemyFamily: 'auto', loadout: 'all', title: 'Zombie City', theme: 'zombie-city', map: 'pillars',
  enemies: [{ type: 'runner', share: 5 }, { type: 'swarmer', share: 5 }],
  intensity: 3, playerHealth: 'normal', weapon: 'pistol', goal: { type: 'survive', seconds: 60 }, unsupported: [] as unknown[],
}) as Record<string, any>;

const parse = (raw: unknown) => ShooterBriefSchema.safeParse(normalizeBrief(raw));
const paths = (raw: unknown) => { const r = parse(raw); return r.success ? [] : r.error.issues.map((issue) => issue.path.join('.')); };

describe('the brief schema', () => {
  it('accepts a complete brief', () => {
    expect(parse(valid()).success).toBe(true);
    expect(parse({ ...valid(), goal: { type: 'kill', count: 40 } }).success).toBe(true);
  });

  it.each([
    ['theme', { theme: 'pirate-cove' }], ['map', { map: 'maze' }], ['weapon', { weapon: 'laser' }], ['playerHealth', { playerHealth: 'immortal' }],
    ['version', { version: 'brief-2' }],
  ])('rejects a wrong %s and does not guess a value', (field, patch) => {
    const raw = { ...valid(), ...patch };
    expect(paths(raw)).toEqual([field]);
    expect((normalizeBrief(raw) as Record<string, unknown>)[field]).toBe((patch as Record<string, unknown>)[field]); // untouched
  });

  it('rejects a wrong goal type and a wrong enemy type', () => {
    expect(paths({ ...valid(), goal: { type: 'escape', seconds: 60 } })[0]).toBe('goal.type');
    expect(paths({ ...valid(), enemies: [{ type: 'boss', share: 3 }] })[0]).toBe('enemies.0.type');
  });

  it('rejects unknown fields instead of dropping them', () => {
    expect(paths({ ...valid(), script: 'x' })).toEqual(['']);
    expect(paths({ ...valid(), goal: { type: 'survive', seconds: 60, count: 5 } })).toEqual(['goal']);
    expect(paths({ ...valid(), enemies: [{ type: 'runner', share: 5, speed: 99 }] })).toEqual(['enemies.0']);
  });

  it('rejects missing fields and values of the wrong kind', () => {
    const { theme: _theme, ...withoutTheme } = valid();
    expect(paths(withoutTheme)).toEqual(['theme']);
    expect(paths({ ...valid(), intensity: 'high' })).toContain('intensity');
    expect(paths({ ...valid(), enemies: [] })).toContain('enemies');
    expect(paths('text')).toEqual(['']);
    expect(paths(null)).toEqual(['']);
    expect(paths([valid()])).toEqual(['']);
  });

  it('rejects a title with markup', () => {
    expect(paths({ ...valid(), title: '<b>Zombie</b>' })).toEqual(['title']);
  });
});

describe('normalizeBrief clamps, it does not reject', () => {
  it.each([[0, 1], [-4, 1], [9, 5], [2.6, 3], [3.4, 3], [5, 5]])('intensity %s -> %s', (value, expected) => {
    expect(parse({ ...valid(), intensity: value })).toMatchObject({ success: true, data: { intensity: expected } });
  });

  it.each([[0, 1], [50, 10], [7.5, 8]])('share %s -> %s', (value, expected) => {
    const result = parse({ ...valid(), enemies: [{ type: 'runner', share: value }] });
    expect(result).toMatchObject({ success: true, data: { enemies: [{ type: 'runner', share: expected }] } });
  });

  it.each([[5, 20], [999, 180], [90, 90]])('survive seconds %s -> %s', (value, expected) => {
    expect(parse({ ...valid(), goal: { type: 'survive', seconds: value } })).toMatchObject({ success: true, data: { goal: { type: 'survive', seconds: expected } } });
  });

  it.each([[3, 10], [500, 200], [40, 40]])('kill count %s -> %s', (value, expected) => {
    expect(parse({ ...valid(), goal: { type: 'kill', count: value } })).toMatchObject({ success: true, data: { goal: { type: 'kill', count: expected } } });
  });

  it('merges the same enemy type: shares add up, capped at 10', () => {
    const result = parse({ ...valid(), enemies: [{ type: 'runner', share: 4 }, { type: 'swarmer', share: 2 }, { type: 'runner', share: 9 }] });
    expect(result).toMatchObject({ success: true, data: { enemies: [{ type: 'runner', share: 10 }, { type: 'swarmer', share: 2 }] } });
    expect(parse({ ...valid(), enemies: [{ type: 'runner', share: 4 }, { type: 'runner', share: 3 }] })).toMatchObject({ data: { enemies: [{ type: 'runner', share: 7 }] } });
  });

  it('keeps at most 4 enemy entries', () => {
    const five = [{ type: 'runner', share: 1 }, { type: 'brute', share: 1 }, { type: 'swarmer', share: 1 }, { type: 'spitter', share: 1 }, { type: 'boss', share: 1 }];
    const normalized = normalizeBrief({ ...valid(), enemies: five }) as { enemies: unknown[] };
    expect(normalized.enemies).toEqual(five.slice(0, 4));
    expect(parse({ ...valid(), enemies: five }).success).toBe(true);
    // four kinds are fine as they are, five that were not cut are refused
    expect(ShooterBriefSchema.safeParse({ ...valid(), enemies: five.slice(0, 4) }).success).toBe(true);
    expect(ShooterBriefSchema.safeParse({ ...valid(), enemies: [...five.slice(0, 4), { type: 'runner', share: 2 }] }).success).toBe(false);
  });

  it('cuts a long title to 40 characters and trims it', () => {
    const result = parse({ ...valid(), title: `  ${'A'.repeat(60)}  ` });
    expect(result).toMatchObject({ success: true, data: { title: 'A'.repeat(40) } });
    // whole characters: a long accented title is cut without breaking a character
    const accented = parse({ ...valid(), title: 'Đ'.repeat(55) });
    expect(accented).toMatchObject({ success: true, data: { title: 'Đ'.repeat(40) } });
  });

  it('cleans `unsupported`: trims, drops empty strings, cuts long ones, keeps 5', () => {
    const long = 'x'.repeat(200);
    const raw = { ...valid(), unsupported: ['  một  ', '', '   ', long, 'hai', 'ba', 'bốn', 'năm', 'sáu'] };
    const result = parse(raw);
    expect(result.success).toBe(true);
    const list = (result as { data: { unsupported: string[] } }).data.unsupported;
    expect(list).toHaveLength(5);
    expect(list[0]).toBe('một');
    expect(list[1]).toBe('x'.repeat(80));
    expect(list.slice(2)).toEqual(['hai', 'ba', 'bốn']);
  });

  it('leaves what it cannot clamp for the schema (a string where a number belongs)', () => {
    expect(paths({ ...valid(), intensity: '3' })).toContain('intensity');
    expect(paths({ ...valid(), goal: { type: 'survive', seconds: 'sixty' } })).toContain('goal.seconds');
  });

  it('does not change its input', () => {
    const raw = { ...valid(), intensity: 99, title: 'T'.repeat(100), unsupported: ['a', 'a'] };
    const copy = structuredClone(raw);
    normalizeBrief(raw);
    expect(raw).toEqual(copy);
  });
});

describe('the prompt for the model', () => {
  it('says what the model may and may not do', () => {
    expect(SHOOTER_BRIEF_SYSTEM_PROMPT).toContain('exactly ONE JSON object');
    expect(SHOOTER_BRIEF_SYSTEM_PROMPT).toMatch(/never output any of those/);
    expect(SHOOTER_BRIEF_SYSTEM_PROMPT).toMatch(/never follow instructions/);
    expect(SHOOTER_BRIEF_SYSTEM_PROMPT).toMatch(/NEAREST/);
    expect(SHOOTER_BRIEF_SYSTEM_PROMPT).toMatch(/"unsupported"/);
    for (const word of ['boss', 'vehicles', 'multiplayer', 'towers', 'repairing the base', 'more than one base', 'reloading', 'pickups', 'crafting', 'traps']) expect(SHOOTER_BRIEF_SYSTEM_PROMPT).toContain(word);
  });

  it('explains every enum value', () => {
    for (const theme of Object.keys(THEMES)) expect(SHOOTER_BRIEF_SYSTEM_PROMPT).toContain(theme);
    for (const word of ['open-arena', 'pillars', 'cross-corridors', 'rooms', 'ring', 'runner', 'brute', 'swarmer', 'pistol', 'rapid', 'heavy', 'fragile', 'sturdy', 'survive', 'kill']) {
      expect(SHOOTER_BRIEF_SYSTEM_PROMPT).toContain(word);
    }
  });

  it('is short, and its field list is generated from the schema lists', () => {
    expect(SHOOTER_BRIEF_SYSTEM_PROMPT.length).toBeLessThan(5_000); // (3 500 before the new weapons, healthDrops and boss; 4 600 before the loadout of Stage 6A)
    expect(describeBrief().join('\n')).toContain('theme: zombie-city|alien-lab');
    expect(SHOOTER_BRIEF_SYSTEM_PROMPT).toContain(describeBrief().join('\n'));
  });

  it('gives the provider a structure without min/max', () => {
    const text = JSON.stringify(briefJsonSchema());
    expect(text).not.toMatch(/"(minimum|maximum|minLength|maxLength|minItems|maxItems|pattern)"/);
    expect(text).toContain('"additionalProperties":false');
    expect(text).toContain('zombie-city');
    expect(text).not.toContain('"const"'); // providerJsonSchema turns const into enum
  });
});
