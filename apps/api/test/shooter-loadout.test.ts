import { describe, expect, it, vi } from 'vitest';
import { SHOOTER_LEVELS, ShooterLevelSchema, createSim, startingSlot } from '@game-creator/contracts';
import { AiGateway } from '../src/services/ai-gateway.js';
import type { DiagnosticsFinish } from '../src/services/run-diagnostics.js';
import { LOADOUTS, SHOOTER_THEMES, ShooterBriefSchema, WEAPONS, normalizeBrief, type ShooterBrief } from '../src/shooter/brief.js';
import { compileShooter } from '../src/shooter/compile.js';
import { compileAndGate } from '../src/shooter/compile-job.js';
import { gateLevel } from '../src/shooter/gate.js';
import { guardUnrequested, keywordNotices } from '../src/shooter/notices.js';
import { ARSENAL_ORDER, WEAPONS as PRESETS } from '../src/shooter/presets.js';
import { SHOOTER_BRIEF_SYSTEM_PROMPT, briefJsonSchema, describeBrief } from '../src/shooter/prompt.js';
import { ShooterService } from '../src/shooter/service.js';
import { mockProvider, mockRegistry } from './fixtures.js';

vi.setConfig({ testTimeout: 120_000 });

const raw = (patch: Record<string, unknown> = {}) => ({
  version: 'brief-1', healthDrops: 'none', boss: 'none', base: 'none', enemyFamily: 'auto', loadout: 'all', title: 'Súng', theme: 'zombie-city', map: 'open-arena',
  enemies: [{ type: 'runner', share: 5 }], intensity: 1, playerHealth: 'normal', weapon: 'pistol', goal: { type: 'survive', seconds: 60 }, unsupported: [] as unknown[], ...patch,
}) as Record<string, unknown>;
const brief = (patch: Record<string, unknown> = {}): ShooterBrief => ShooterBriefSchema.parse(normalizeBrief(raw(patch)));

describe('the loadout of a brief', () => {
  it('is all or single, and a brief without it fails the schema', () => {
    expect([...LOADOUTS]).toEqual(['all', 'single']);
    const { loadout: _gone, ...without } = raw();
    expect(ShooterBriefSchema.safeParse(without).success).toBe(false);
  });

  it('is filled with all when the model left it out, and a value that is there but wrong is refused', () => {
    const { loadout: _gone, ...without } = raw();
    expect((normalizeBrief(without) as { loadout: string }).loadout).toBe('all');
    expect(ShooterBriefSchema.safeParse(normalizeBrief(without)).success).toBe(true);
    for (const wrong of ['everything', null, 3, 'ALL', '']) expect(ShooterBriefSchema.safeParse(normalizeBrief(raw({ loadout: wrong }))).success, String(wrong)).toBe(false);
    expect(brief({ loadout: 'single' }).loadout).toBe('single');
  });

  it('is described to the model: weapon is the weapon it STARTS with, loadout all by default, single only when the user limits the weapons', () => {
    expect(describeBrief()).toContain('loadout: all|single');
    expect(SHOOTER_BRIEF_SYSTEM_PROMPT).toContain('the weapon the player STARTS with');
    expect(SHOOTER_BRIEF_SYSTEM_PROMPT).toContain('loadout: all by default');
    expect(SHOOTER_BRIEF_SYSTEM_PROMPT).toContain('single ONLY when the user clearly wants to be limited to one weapon');
    expect(JSON.stringify(briefJsonSchema())).toContain('"loadout"');
  });

  it('no longer lists "switching between weapons" among what the engine cannot do, but still lists ammo and upgrades', () => {
    expect(SHOOTER_BRIEF_SYSTEM_PROMPT).not.toContain('switching between weapons');
    expect(SHOOTER_BRIEF_SYSTEM_PROMPT).toContain('limited ammo or reloading');
    expect(SHOOTER_BRIEF_SYSTEM_PROMPT).toContain('upgrades');
  });

  it('keeps the system prompt short', () => {
    expect(SHOOTER_BRIEF_SYSTEM_PROMPT.length).toBeLessThan(5_200);
  });
});

describe('the guard on the loadout: single stays only when the text limits the weapons', () => {
  const guard = (prompt: string, loadout = 'single') => guardUnrequested({ healthDrops: 'none', base: 'none', loadout }, prompt);
  const LIMITS = [
    'Chỉ có súng ngắn, hạ 40 zombie', 'chỉ dùng shotgun thôi', 'chỉ được bắn bằng súng xuyên', 'một khẩu súng duy nhất', 'chỉ có một loại súng', 'chỉ 1 loại súng',
    'không đổi súng', 'không thể đổi súng', 'súng cố định', 'Only a pistol', 'single weapon only', 'no weapon switching', 'just the shotgun', 'one weapon',
    'chi co sung ngan', 'chỉ shotgun', 'only pistol, no switching',
  ];
  const NOT_LIMITS = ['Sống sót 60 giây', 'bảo vệ căn cứ, có boss cuối', 'Một màn bắn súng', 'zombie trong rừng tối, súng shotgun', 'hạ 40 quái bằng súng xuyên', 'a fast shooter with robots'];

  it('keeps single when the user limited the weapons, in Vietnamese and in English, with or without accents', () => {
    for (const prompt of LIMITS) expect(guard(prompt), prompt).toEqual({ brief: { healthDrops: 'none', base: 'none', loadout: 'single' }, removed: [] });
  });

  it('puts single back to all when the text says nothing of a limit, and records it as a removal (no notice, no message)', () => {
    for (const prompt of NOT_LIMITS) {
      const guarded = guard(prompt);
      expect(guarded.brief.loadout, prompt).toBe('all');
      expect(guarded.removed, prompt).toEqual(['loadout']);
    }
  });

  it('never touches an all', () => {
    for (const prompt of [...LIMITS, ...NOT_LIMITS]) expect(guard(prompt, 'all'), prompt).toEqual({ brief: { healthDrops: 'none', base: 'none', loadout: 'all' }, removed: [] });
  });

  it('is not fooled by a commander ("chỉ huy" is not a limit), but may keep a limit for "chỉ có zombie" (broad on purpose)', () => {
    expect(guard('chỉ huy quân đội chống zombie').removed).toEqual(['loadout']);
    expect(guard('Chỉ huy căn cứ quân sự').brief.loadout).toBe('all');
    // the accepted false positive: "chỉ có" is in the list, so a brief with single and this sentence keeps its single
    expect(guard('chỉ có zombie và robot, không có boss').brief.loadout).toBe('single');
  });

  it('lists the removal with the other guards, in the diagnostics', () => {
    expect(guardUnrequested({ healthDrops: 'some', base: 'defend', loadout: 'single' }, 'một màn bắn súng').removed).toEqual(['healthDrops', 'base', 'loadout']);
  });
});

describe('a compiled level and its arsenal', () => {
  it('has the five weapons in the order of the keys, with the weapon the brief names as the starting one', () => {
    for (const weapon of WEAPONS) {
      const { level } = compileShooter(brief({ weapon }), 4242);
      expect(level.arsenal!.map((entry) => entry.id)).toEqual(['pistol', 'shotgun', 'piercing', 'rapid', 'heavy']);
      expect(level.arsenal!.map((entry) => entry.weapon)).toEqual(ARSENAL_ORDER.map((id) => PRESETS[id]));
      expect(level.weapon).toEqual(PRESETS[weapon]);
      expect(level.arsenal![startingSlot(level)]!.id).toBe(weapon);
      expect(createSim(level).weaponSlot).toBe(ARSENAL_ORDER.indexOf(weapon));
      expect(ShooterLevelSchema.safeParse(level).success, weapon).toBe(true);
    }
  });

  it('has none with a loadout of single, exactly like before', () => {
    const { level } = compileShooter(brief({ loadout: 'single', weapon: 'shotgun' }), 4242);
    expect('arsenal' in level).toBe(false);
    expect(level.weapon).toEqual(PRESETS.shotgun);
    expect('weaponSlot' in createSim(level)).toBe(false);
  });

  it('is the only difference between the two loadouts (the same level otherwise)', () => {
    for (const theme of SHOOTER_THEMES) {
      const all = compileShooter(brief({ theme }), 99).level;
      const single = compileShooter(brief({ theme, loadout: 'single' }), 99).level;
      const { arsenal: _arsenal, ...rest } = all;
      expect(JSON.stringify(rest)).toBe(JSON.stringify(single).replace(/"arsenal":\[[^\]]*\],?/, ''));
    }
  });

  it('keeps its arsenal through the gate (the bots, which never switch, are what the gate asks)', () => {
    const level = compileShooter(brief({ intensity: 4 }), 5).level;
    const gated = gateLevel(level);
    expect(gated.level.arsenal).toEqual(level.arsenal);
    expect(gated.level.weapon).toEqual(level.weapon);
    const job = compileAndGate({ brief: brief({ intensity: 3 }), seed: 8 });
    expect(job.level.arsenal).toHaveLength(5);
  });

  it('puts the weapon of an arsenal beside the same numbers the calibration used', () => {
    for (const id of ARSENAL_ORDER) expect(PRESETS[id]).toBeDefined();
    expect(ARSENAL_ORDER).toEqual(['pistol', 'shotgun', 'piercing', 'rapid', 'heavy']);
  });
});

describe('the notices: switching weapons is a feature now', () => {
  it('says nothing for asking to switch weapons, and still reports ammo, upgrades and pick-ups', () => {
    expect(keywordNotices('có thể đổi vũ khí giữa các súng', [])).toEqual([]);
    expect(keywordNotices('hết đạn phải nạp đạn', []).join(' ')).toContain('giới hạn đạn');
    expect(keywordNotices('nâng cấp súng', []).join(' ')).toContain('nâng cấp');
  });
});

describe('the service: a single the user did not ask for is taken out, and the diagnostics say so', () => {
  const setup = (prompt: string, answer: Record<string, unknown>) => {
    const finished: DiagnosticsFinish[] = [];
    const gateway = new AiGateway(mockRegistry([mockProvider('groq', async () => JSON.stringify(answer))]));
    const service = new ShooterService(gateway, {
      compile: async (job) => compileAndGate(job), seed: () => 11,
      openDiagnostics: async () => ({ async note() {}, async raw() {}, async finish(record) { finished.push(record); } }),
    });
    return { run: () => service.generate({ prompt, providerId: 'groq' }, 'test', new AbortController().signal), finished };
  };

  it('"một màn bắn súng" with loadout single: the level has the five weapons, no notice, a guardRemoved entry', async () => {
    const { run, finished } = setup('một màn bắn súng', raw({ loadout: 'single' }));
    const project = await run();
    expect(project.level.arsenal).toHaveLength(5);
    expect(project.notices.join(' ')).not.toMatch(/súng|vũ khí/);
    expect((finished[0]!.report as { guardRemoved?: string[] }).guardRemoved).toEqual(['loadout']);
  });

  it('"Chỉ có súng ngắn" with loadout single: one weapon, no arsenal, no guard entry', async () => {
    const { run, finished } = setup('Chỉ có súng ngắn, hạ 40 zombie', raw({ loadout: 'single', goal: { type: 'kill', count: 40 } }));
    const project = await run();
    expect('arsenal' in project.level).toBe(false);
    expect(finished[0]!.report).not.toHaveProperty('guardRemoved');
  });

  it('the hand-made levels of the earlier stages still have no arsenal (only "arsenal" does)', () => {
    for (const [name, level] of Object.entries(SHOOTER_LEVELS)) expect('arsenal' in level, name).toBe(name === 'arsenal');
  });
});
