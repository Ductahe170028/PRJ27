import { describe, expect, it, vi } from 'vitest';
import {
  BASE_SIZE, BRUTE_CLEARANCE, NAV_INFLATE, ShooterLevelSchema, baseRectOf, blockedCells, bossBlockedCells, freeSpaceConnected, ENEMY_TYPES,
  type PlayResult, type ShooterLevel,
} from '@game-creator/contracts';
import { AiGateway } from '../src/services/ai-gateway.js';
import type { DiagnosticsFinish } from '../src/services/run-diagnostics.js';
import { BASES, PLAYER_HEALTHS, SHOOTER_MAPS, ShooterBriefSchema, normalizeBrief, type ShooterBrief } from '../src/shooter/brief.js';
import { MAP_SIMPLIFIED_NOTICE, compileShooter } from '../src/shooter/compile.js';
import { compileAndGate } from '../src/shooter/compile-job.js';
import { BASE_HP_FACTOR, MAX_BASE_HP, THINNED_NOTICE, gateLevel } from '../src/shooter/gate.js';
import { guardUnrequested, keywordNotices } from '../src/shooter/notices.js';
import { BASE_HP_BY_INTENSITY, BASE_PLAYER, baseFor } from '../src/shooter/presets.js';
import { SHOOTER_BRIEF_SYSTEM_PROMPT, briefJsonSchema, describeBrief } from '../src/shooter/prompt.js';
import { ShooterService } from '../src/shooter/service.js';
import { mockProvider, mockRegistry } from './fixtures.js';

vi.setConfig({ testTimeout: 120_000 });

const raw = (patch: Record<string, unknown> = {}) => ({
  version: 'brief-1', healthDrops: 'none', boss: 'none', base: 'defend', enemyFamily: 'auto', title: 'Căn cứ', theme: 'military-base', map: 'open-arena',
  enemies: [{ type: 'runner', share: 5 }, { type: 'swarmer', share: 5 }],
  intensity: 3, playerHealth: 'normal', weapon: 'pistol', goal: { type: 'survive', seconds: 60 }, unsupported: [] as unknown[], ...patch,
}) as Record<string, any>;
const brief = (patch: Record<string, unknown> = {}): ShooterBrief => ShooterBriefSchema.parse(normalizeBrief(raw(patch)));
const sideOf = (level: ShooterLevel) => [Math.round(level.player.x - level.base!.x), Math.round(level.player.y - level.base!.y)];

describe('the brief takes a base', () => {
  it('none or defend', () => {
    expect([...BASES]).toEqual(['none', 'defend']);
    for (const base of BASES) expect(ShooterBriefSchema.safeParse(raw({ base })).success, base).toBe(true);
  });

  it('missing becomes "none" (the one guess); a value that is there but wrong is refused', () => {
    const { base: _omit, ...without } = raw();
    void _omit;
    expect((normalizeBrief(without) as Record<string, unknown>).base).toBe('none');
    expect(ShooterBriefSchema.safeParse(without).success).toBe(false); // the schema itself needs it
    for (const bad of ['fortress', 'Defend', '', null, 2, true, ['defend']]) {
      const parsed = ShooterBriefSchema.safeParse(normalizeBrief(raw({ base: bad })));
      expect(parsed.success, String(bad)).toBe(false);
      if (!parsed.success) expect(parsed.error.issues.map((i) => i.path.join('.'))).toContain('base');
    }
  });

  it('what the model is told: the base field, when to pick it, and what is still missing', () => {
    expect(describeBrief()).toContain('base: none|defend');
    const text = SHOOTER_BRIEF_SYSTEM_PROMPT;
    expect(text).toMatch(/base: none by default; defend when the user wants to protect, defend or hold a base/);
    for (const word of ['building or upgrading towers, turrets or walls', 'repairing the base', 'more than one base']) expect(text).toContain(word);
    expect(text).not.toContain('base or tower defense');
    expect(text.length).toBeLessThan(5_200);
    expect(JSON.stringify(briefJsonSchema())).toContain('"base"');
  });
});

describe('compiling a brief with a base', () => {
  it('puts the base in the middle, with the hit points of the intensity, and the player 64 px away on one side', () => {
    expect(BASE_PLAYER.gap).toBeGreaterThanOrEqual(56);
    expect(BASE_PLAYER.gap).toBeLessThanOrEqual(90);
    for (let intensity = 1; intensity <= 5; intensity += 1) {
      const level = compileShooter(brief({ intensity }), 8).level;
      expect(level.base).toEqual({ x: 480, y: 305, hp: BASE_HP_BY_INTENSITY[intensity - 1] });
      expect(level.base).toEqual(baseFor(intensity));
      expect(ShooterLevelSchema.safeParse(level).success).toBe(true);
      const [dx, dy] = sideOf(level) as [number, number];
      expect(Math.abs(dx) + Math.abs(dy)).toBe(BASE_PLAYER.gap);
      expect(dx === 0 || dy === 0).toBe(true);
    }
    // the harder the level, the more a base can take (never less than the level before it)
    for (let i = 1; i < BASE_HP_BY_INTENSITY.length; i += 1) expect(BASE_HP_BY_INTENSITY[i]!).toBeGreaterThanOrEqual(BASE_HP_BY_INTENSITY[i - 1]!);
    for (const hp of BASE_HP_BY_INTENSITY) { expect(hp).toBeGreaterThanOrEqual(20); expect(hp).toBeLessThanOrEqual(MAX_BASE_HP); }
  });

  it('the side of the player turns with seed % 4: up, down, left, right on an empty field', () => {
    const sides = [4, 5, 6, 7].map((seed) => sideOf(compileShooter(brief(), seed).level));
    expect(sides).toEqual([[0, -64], [0, 64], [-64, 0], [64, 0]]);
    expect(sideOf(compileShooter(brief(), 8).level)).toEqual([0, -64]); // 8 % 4 = 0 again
  });

  it('a brief without a base compiles to a level that has no base and starts the player where it always did', () => {
    const level = compileShooter(brief({ base: 'none' }), 12).level;
    expect('base' in level).toBe(false);
    expect(level.player).toMatchObject({ x: 480, y: 305 });
  });

  it('a base and a boss in one level compile, and the boss can get to the player round the base', () => {
    for (const boss of ['crusher', 'gunner'] as const) {
      const level = compileShooter(brief({ boss, map: 'pillars' }), 21).level;
      expect(level.base).toBeDefined();
      expect(level.win).toEqual({ type: 'boss' });
      const walls = [...level.obstacles, baseRectOf(level.base!)];
      expect(freeSpaceConnected(level, 0, bossBlockedCells(walls, ENEMY_TYPES[boss].radius)), boss).toBe(true);
    }
  });

  it('every layout is walkable: 30 seeds x 5 maps, every spawn point reaches the player (with the base in the way) and the base itself', () => {
    let simplified = 0;
    for (const map of SHOOTER_MAPS) {
      for (let seed = 1; seed <= 30; seed += 1) {
        const compiled = compileShooter(brief({ map, intensity: 1 + (seed % 5), playerHealth: PLAYER_HEALTHS[seed % 3] }), seed * 7919);
        if (compiled.notices.includes(MAP_SIMPLIFIED_NOTICE)) simplified += 1;
        const level = compiled.level;
        const label = `${map} ${seed}`;
        const walls = [...level.obstacles, baseRectOf(level.base!)];
        expect(freeSpaceConnected(level, BRUTE_CLEARANCE, blockedCells(walls, BRUTE_CLEARANCE / 2)), label).toBe(true);
        expect(freeSpaceConnected({ ...level, player: { ...level.player, x: level.base!.x, y: level.base!.y } }, 0, blockedCells(level.obstacles, NAV_INFLATE)), label).toBe(true);
        expect(ShooterLevelSchema.safeParse(level).success, label).toBe(true);
        expect(level.spawnPoints.length).toBeGreaterThanOrEqual(3);
        expect(level.obstacles.every((block) => Math.max(Math.abs(block.x - 480) - (block.width + BASE_SIZE) / 2, 0) ** 2 + Math.max(Math.abs(block.y - 305) - (block.height + BASE_SIZE) / 2, 0) ** 2 >= 48 * 48), label).toBe(true);
      }
    }
    expect(simplified).toBeLessThan(5 * 30); // (the share per map is measured in docs/shooter-calibration.md)
  });
});

describe('the gate with a base', () => {
  const result = (level: ShooterLevel, won: boolean): PlayResult => ({ status: won ? 'won' : 'lost', seconds: 1, kills: 0, hp: 1, maxHp: 1, hpLeft: won ? 1 : 0, state: { level } as never });
  /** Plays a fake game that is won once the level has been eased `after` times. */
  const easeUntil = (level: ShooterLevel, after: number) => {
    const seen: ShooterLevel[] = [];
    const play = (lvl: ShooterLevel) => {
      if (!seen.some((s) => JSON.stringify({ ...s, seed: 0 }) === JSON.stringify({ ...lvl, seed: 0 }))) seen.push(lvl);
      return result(lvl, seen.length - 1 >= after);
    };
    return { out: gateLevel(level, { play }), seen };
  };

  it('each easing step gives the base 15% more hit points (rounded up, at most 200) as well as fewer enemies', () => {
    expect(BASE_HP_FACTOR).toBe(1.15);
    expect(MAX_BASE_HP).toBe(200);
    const level = compileShooter(brief({ intensity: 1 }), 5).level;
    const chain = [BASE_HP_BY_INTENSITY[0]!]; // the base of intensity 1, then 15% more each step
    for (let i = 1; i < 5; i += 1) chain.push(Math.min(MAX_BASE_HP, Math.ceil(chain[i - 1]! * BASE_HP_FACTOR)));
    const { out, seen } = easeUntil(level, 4);
    expect(seen.map((s) => s.base!.hp)).toEqual(chain);
    expect(out.report.thinSteps).toBe(4);
    expect(out.notices).toEqual([THINNED_NOTICE]);
    const total = (l: ShooterLevel) => l.waves.reduce((n, w) => n + w.count, 0);
    expect(total(seen[1]!)).toBeLessThan(total(seen[0]!));
    expect(seen.every((s) => s.base!.x === 480 && s.base!.y === 305)).toBe(true);
  });

  it('never above 200', () => {
    const level = { ...compileShooter(brief(), 5).level, base: { x: 480, y: 305, hp: 190 } };
    const { seen } = easeUntil(level, 2);
    expect(seen.map((s) => s.base!.hp)).toEqual([190, 200, 200]);
  });

  it('intensity 5 starts at the cap, so the gate only has fewer enemies left to give: the base stays at 200 and every level still parses', () => {
    const level = compileShooter(brief({ intensity: 5 }), 5).level;
    expect(level.base!.hp).toBe(BASE_HP_BY_INTENSITY[4]);
    expect(level.base!.hp).toBe(MAX_BASE_HP);
    const { seen } = easeUntil(level, 3);
    expect(seen.map((s) => s.base!.hp)).toEqual([200, 200, 200, 200]);
    expect(seen.every((s) => ShooterLevelSchema.safeParse(s).success)).toBe(true);
    const total = (l: ShooterLevel) => l.waves.reduce((n, w) => n + w.count, 0);
    expect(total(seen[3]!)).toBeLessThan(total(seen[0]!));
  });

  it('a level that is won at once keeps its base as it was, and a level with no base is eased as before', () => {
    const level = compileShooter(brief(), 5).level;
    expect(easeUntil(level, 0).out.level.base).toEqual(level.base);
    const plain = compileShooter(brief({ base: 'none' }), 5).level;
    const { seen } = easeUntil(plain, 2);
    expect(seen.every((s) => !('base' in s))).toBe(true);
  });

  it('a boss level with a base is eased too: fewer ordinary enemies, a weaker boss and a sturdier base; the boss wave stays', () => {
    const level = compileShooter(brief({ boss: 'crusher' }), 6).level;
    const { seen } = easeUntil(level, 1);
    expect(seen[1]!.base!.hp).toBe(Math.ceil(level.base!.hp * 1.15));
    expect(seen[1]!.bossHp!).toBeLessThan(level.bossHp!);
    expect(seen[1]!.waves.filter((w) => w.type === 'crusher')).toEqual(level.waves.filter((w) => w.type === 'crusher'));
  });

  it('compile and gate together: the real bot, a base level, still compiles', () => {
    const job = compileAndGate({ brief: brief({ intensity: 2, map: 'pillars' }), seed: 31 });
    expect(job.level.base).toBeDefined();
    expect(ShooterLevelSchema.safeParse(job.level).success).toBe(true);
    expect(job.report.wins).toBeGreaterThanOrEqual(2);
  });
});

describe('what the model added that the user did not ask for', () => {
  const asked = (healthDrops: string, base: string, prompt: string) => guardUnrequested({ healthDrops, base }, prompt);

  it('health drops stay when the text could mean them (6 Vietnamese, 3 English)', () => {
    for (const prompt of ['có hộp máu rơi', 'nhặt bình máu để hồi phục', 'hồi phục máu khi hạ quái', 'quái rơi vật phẩm', 'thuốc hồi sức cho người chơi', 'có tim hồi máu',
      'with health pickups', 'enemies drop medkits', 'items that heal you']) {
      expect(asked('some', 'none', prompt), prompt).toEqual({ brief: { healthDrops: 'some', base: 'none' }, removed: [] });
    }
  });

  it('health drops go when the text has no word for them (6 Vietnamese, 3 English), and nothing is added for the user', () => {
    for (const prompt of ['zombie thành phố 60 giây', 'rừng tối, súng shotgun', 'hạ 40 quái ở sa mạc', 'bệnh viện bỏ hoang, quái đi chậm', 'bảo vệ căn cứ có boss cuối', 'quái ngoài hành tinh, súng bắn nhanh',
      'survive 60 seconds in a dark forest', 'kill 40 zombies in a desert', 'fast zombies and a shotgun']) {
      expect(asked('many', 'none', prompt), prompt).toEqual({ brief: { healthDrops: 'none', base: 'none' }, removed: ['healthDrops'] });
      expect(keywordNotices(prompt, []).join(' ')).not.toMatch(/hồi máu|căn cứ/); // not a word to the user either
    }
  });

  it('a base stays when the text could mean it (6 Vietnamese, 3 English)', () => {
    for (const prompt of ['bảo vệ căn cứ khỏi zombie', 'giữ nhà trước quái', 'phòng thủ trại quân sự', 'bảo vệ pháo đài', 'canh giữ trụ sở', 'căn cứ quân sự bị tấn công',
      'defend the base', 'protect the house', 'guard the castle']) {
      expect(asked('none', 'defend', prompt), prompt).toEqual({ brief: { healthDrops: 'none', base: 'defend' }, removed: [] });
    }
  });

  it('a base goes when the text has no word for it (6 Vietnamese, 3 English); "thành phố" is a city, not a castle', () => {
    for (const prompt of ['zombie thành phố 60 giây', 'sống sót trong rừng tối', 'hạ 50 quái trong sa mạc', 'bắn quái ngoài hành tinh', 'sa mạc nóng bỏng, súng shotgun', 'rừng ma ám, hạ 40 quái',
      'survive in a dark forest', 'kill 40 aliens', 'a fast shooter with a rapid gun']) {
      expect(asked('none', 'defend', prompt), prompt).toEqual({ brief: { healthDrops: 'none', base: 'none' }, removed: ['base'] });
    }
  });

  it('both can go at once, and nothing of the brief is touched but those two fields', () => {
    const original = { healthDrops: 'some', base: 'defend', boss: 'crusher', title: 'x', goal: { type: 'survive', seconds: 60 } };
    const guarded = guardUnrequested(original, 'sống sót ở rừng tối');
    expect(guarded.removed).toEqual(['healthDrops', 'base']);
    expect(guarded.brief).toEqual({ ...original, healthDrops: 'none', base: 'none' });
    expect(original.base).toBe('defend'); // the brief that came in is not changed
  });

  it('a feature that is not there is never "removed", and the boss is left alone whatever the text says', () => {
    expect(asked('none', 'none', 'sống sót ở rừng tối')).toEqual({ brief: { healthDrops: 'none', base: 'none' }, removed: [] });
    for (const boss of ['crusher', 'gunner']) {
      const guarded = guardUnrequested({ healthDrops: 'none', base: 'none', enemyFamily: 'auto', boss }, 'zombie');
      expect(guarded.brief.boss).toBe(boss);
      expect(guarded.removed).toEqual([]);
    }
  });
});

describe('the service takes out what was not asked for, and says nothing to the user', () => {
  const setup = (prompt: string, answer: Record<string, unknown>) => {
    const finished: DiagnosticsFinish[] = [];
    const gateway = new AiGateway(mockRegistry([mockProvider('groq', async () => JSON.stringify(answer))]));
    const service = new ShooterService(gateway, {
      compile: async (job) => compileAndGate(job), seed: () => 11,
      openDiagnostics: async () => ({ async note() {}, async raw() {}, async finish(record) { finished.push(record); } }),
    });
    return { run: () => service.generate({ prompt, providerId: 'groq' }, 'test', new AbortController().signal), finished };
  };

  it('a base and health drops that the text never asked for: the level has neither, the notices do not mention them, the diagnostics do', async () => {
    const { run, finished } = setup('zombie thành phố 60 giây', raw({ healthDrops: 'some', base: 'defend' }));
    const project = await run();
    expect('base' in project.level).toBe(false);
    expect('drops' in project.level).toBe(false);
    expect(project.notices.join(' ')).not.toMatch(/căn cứ|hồi máu/);
    expect((finished[0]!.report as { guardRemoved?: string[] }).guardRemoved).toEqual(['healthDrops', 'base']);
  });

  it('a base that the text did ask for stays, with no notice about it, and the diagnostics have no guard entry', async () => {
    const { run, finished } = setup('bảo vệ căn cứ khỏi zombie trong 90 giây', raw({ intensity: 1, goal: { type: 'survive', seconds: 90 } }));
    const project = await run();
    expect(project.level.base).toBeDefined();
    expect(project.notices.join(' ')).not.toMatch(/Chưa hỗ trợ: bảo vệ căn cứ/);
    expect(finished[0]!.report).not.toHaveProperty('guardRemoved');
  });

  it('building towers around the base: the base stays and the sentence about towers is the one notice', async () => {
    const { run } = setup('xây tháp pháo quanh căn cứ rồi bảo vệ nó', raw());
    const project = await run();
    expect(project.level.base).toBeDefined();
    expect(project.notices).toContain('Chưa hỗ trợ: xây hoặc nâng cấp tháp, tường. Căn cứ không thể xây thêm.');
  });
});
