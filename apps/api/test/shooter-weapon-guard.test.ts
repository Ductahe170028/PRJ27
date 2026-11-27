import { describe, expect, it, vi } from 'vitest';
import { AiGateway } from '../src/services/ai-gateway.js';
import type { DiagnosticsFinish } from '../src/services/run-diagnostics.js';
import { ShooterBriefSchema } from '../src/shooter/brief.js';
import { compileAndGate } from '../src/shooter/compile-job.js';
import { guardUnrequested } from '../src/shooter/notices.js';
import { WEAPONS as PRESETS } from '../src/shooter/presets.js';
import { ShooterService } from '../src/shooter/service.js';
import { LIMIT_PHRASES, LIMIT_WORDS, SEVERAL_WEAPONS_NOTICE, guardWeapons } from '../src/shooter/weapon-guard.js';
import { WEAPON_NAMES, foldPrompt, weaponsNamed, type WeaponId } from '../src/shooter/weapon-words.js';
import { mockProvider, mockRegistry } from './fixtures.js';

vi.setConfig({ testTimeout: 120_000 });

describe('which weapons a sentence names', () => {
  it('knows every name of the table, with and without accents, in any case', () => {
    for (const [id, names] of Object.entries(WEAPON_NAMES) as Array<[WeaponId, readonly string[]]>) {
      for (const name of names) {
        expect(weaponsNamed(`dùng ${name} nhé`), name).toEqual([id]);
        expect(weaponsNamed(name.toUpperCase()), name).toEqual([id]);
      }
    }
    expect(weaponsNamed('súng ngắn')).toEqual(['pistol']);
    expect(weaponsNamed('SÚNG LỤC')).toEqual(['pistol']);
    expect(weaponsNamed('súng săn')).toEqual(['shotgun']);
    expect(weaponsNamed('súng hỏa cải')).toEqual(['shotgun']);
    expect(weaponsNamed('súng xuyên giáp')).toEqual(['piercing']);
    expect(weaponsNamed('bắn xuyên')).toEqual(['piercing']);
    expect(weaponsNamed('súng bắn nhanh')).toEqual(['rapid']);
    expect(weaponsNamed('súng liên thanh')).toEqual(['rapid']);
    expect(weaponsNamed('súng liên tục')).toEqual(['rapid']);
    expect(weaponsNamed('tiểu liên')).toEqual(['rapid']);
    expect(weaponsNamed('súng tự động')).toEqual(['rapid']);
    expect(weaponsNamed('machine gun')).toEqual(['rapid']);
    expect(weaponsNamed('machinegun')).toEqual(['rapid']);
    expect(weaponsNamed('hạng nặng')).toEqual(['heavy']);
    expect(weaponsNamed('đại bác')).toEqual(['heavy']);
    expect(weaponsNamed('the cannon')).toEqual(['heavy']);
  });

  it('does not take "liên tục" alone, "sniper", or a name inside another word', () => {
    for (const text of ['quái tấn công liên tục', 'bắn liên tục vào quái', 'a sniper on the roof', 'heavyweight boxing', 'pistols', 'shotguns', 'zombie city', 'smgs', 'nặng nề', 'sung']) {
      expect(weaponsNamed(text), text).toEqual([]);
    }
  });

  it('lists each weapon once, in the order it first appears', () => {
    expect(weaponsNamed('shotgun, súng ngắn, shotgun, pistol, súng nặng')).toEqual(['shotgun', 'pistol', 'heavy']);
    expect(weaponsNamed('heavy cannon pistol')).toEqual(['heavy', 'pistol']);
    expect(weaponsNamed('một màn bắn súng')).toEqual([]);
  });

  it('ignores a name that comes right after a negation', () => {
    for (const text of ['không dùng shotgun', 'khong dung shotgun', 'đừng dùng shotgun', 'bỏ shotgun', 'trừ shotgun', 'ngoài trừ shotgun', 'without shotgun', 'no shotgun', 'not a shotgun', 'except the shotgun', "don't use shotgun", 'không dùng súng shotgun']) {
      expect(weaponsNamed(text), text).toEqual([]);
    }
    expect(weaponsNamed('hãy dùng shotgun')).toEqual(['shotgun']); // "dùng" is use, "đừng" is don't
    expect(weaponsNamed('không dùng shotgun, dùng súng ngắn')).toEqual(['pistol']);
    expect(weaponsNamed('dùng súng ngắn, không dùng shotgun')).toEqual(['pistol']);
  });

  it('tells "đừng" from "dùng" and folds the rest', () => {
    expect(foldPrompt('Đừng DÙNG Shotgun')).toContain('dungneg dung shotgun');
    expect(foldPrompt('Súng  Ngắn')).toBe('sung ngan');
  });
});

type Case = [prompt: string, weapon: string, loadout: string, model?: { weapon?: string; loadout?: string }, notices?: number];
const guard = (prompt: string, model: { weapon?: string; loadout?: string } = {}) => guardWeapons({ weapon: model.weapon ?? 'pistol', loadout: model.loadout ?? 'all' }, prompt);

describe('the weapon guard: sentence -> weapon and loadout (whatever the model said)', () => {
  const CASES: Case[] = [
    // one weapon named and "only": that weapon, single (even if the model said otherwise)
    ['Chỉ có súng ngắn, hạ 40 zombie', 'pistol', 'single'],
    ['Chỉ có súng ngắn, hạ 40 zombie', 'pistol', 'single', { weapon: 'shotgun', loadout: 'single' }],
    ['Chỉ có súng ngắn, hạ 40 zombie', 'pistol', 'single', { weapon: 'rapid', loadout: 'all' }],
    ['chỉ có súng liên tục', 'rapid', 'single'],
    ['chỉ có súng liên tục', 'rapid', 'single', { loadout: 'all' }],
    ['Chỉ có súng liên tục, sống sót 60 giây', 'rapid', 'single', { weapon: 'pistol', loadout: 'all' }],
    ['chỉ có súng liên thanh', 'rapid', 'single'],
    ['Chỉ có súng liên thanh, bảo vệ căn cứ', 'rapid', 'single', { loadout: 'all' }],
    ['Chỉ dùng shotgun trong rừng tối', 'shotgun', 'single'],
    ['chi co sung ngan', 'pistol', 'single'],
    ['chi dung shotgun', 'shotgun', 'single', { weapon: 'heavy' }],
    ['Only a pistol', 'pistol', 'single'],
    ['just the shotgun please', 'shotgun', 'single'],
    ['only machine gun', 'rapid', 'single'],
    ['chỉ được dùng súng nặng', 'heavy', 'single'],
    ['chỉ xài súng xuyên giáp', 'piercing', 'single'],
    ['duy nhất một khẩu súng lục', 'pistol', 'single'],
    ['súng ngắn duy nhất', 'pistol', 'single'],
    ['Only SMG, survive 60 seconds', 'rapid', 'single'],
    ['single handgun only', 'pistol', 'single'],
    ['chỉ có tiểu liên', 'rapid', 'single'],
    ['chỉ dùng đại bác', 'heavy', 'single'],
    ['chỉ có súng săn', 'shotgun', 'single'],
    ['chỉ có súng hỏa cải', 'shotgun', 'single'],
    ['chỉ có súng bắn nhanh', 'rapid', 'single'],
    ['chỉ có súng tự động', 'rapid', 'single'],
    ['just a cannon', 'heavy', 'single'],
    ['chỉ có súng xuyên', 'piercing', 'single'],
    ['chi co sung lien tuc', 'rapid', 'single'],
    ['chỉ có sung ngắn', 'pistol', 'single'],
    ['CHỈ CÓ SÚNG NGẮN', 'pistol', 'single', { weapon: 'heavy' }],
    ['Chỉ có shotgun, nhưng không dùng súng ngắn', 'shotgun', 'single'],
    ['không dùng shotgun, chỉ dùng súng ngắn', 'pistol', 'single'],
    // one weapon named, no "only": it is the starting weapon, and the loadout is all (a single nobody asked for goes back to all)
    ['Bắt đầu bằng shotgun', 'shotgun', 'all'],
    ['Bắt đầu bằng súng xuyên giáp, hạ boss', 'piercing', 'all'],
    ['Sống sót 60 giây, bắt đầu bằng shotgun', 'shotgun', 'all', { weapon: 'pistol', loadout: 'single' }],
    ['zombie, dùng súng ngắn', 'pistol', 'all'],
    ['dùng súng liên thanh diệt zombie', 'rapid', 'all'],
    ['start with the pistol', 'pistol', 'all', { weapon: 'rapid' }],
    ['a heavy cannon shooter', 'heavy', 'all'],
    ['bắn zombie bằng shotgun trong bệnh viện', 'shotgun', 'all', { loadout: 'single' }],
    ['dùng súng nặng', 'heavy', 'all'],
    ['súng bắn nhanh', 'rapid', 'all'],
    ['tiểu liên và zombie', 'rapid', 'all'],
    // negation: a refused weapon is not wanted
    ['không dùng shotgun', 'pistol', 'all'],
    ['không dùng shotgun', 'rapid', 'all', { weapon: 'rapid' }],
    ['đừng dùng súng nặng', 'pistol', 'all'],
    ['no shotgun, please', 'piercing', 'all', { weapon: 'piercing' }],
    ['without the pistol', 'rapid', 'all', { weapon: 'rapid' }],
    ['ngoài trừ súng ngắn', 'heavy', 'all', { weapon: 'heavy' }],
    ['bỏ súng xuyên giáp', 'pistol', 'all'],
    ['except the cannon', 'pistol', 'all'],
    // several named: all weapons, and a notice only when the user asked to be limited to some of them
    ['Chỉ có súng ngắn và shotgun', 'pistol', 'all', {}, 1],
    ['Chỉ có súng ngắn và shotgun', 'shotgun', 'all', { weapon: 'shotgun' }, 1],
    ['Chỉ có súng ngắn và shotgun', 'pistol', 'all', { weapon: 'rapid' }, 1],
    ['only pistol or shotgun', 'pistol', 'all', {}, 1],
    ['chỉ dùng súng nặng hoặc súng liên thanh', 'heavy', 'all', {}, 1],
    ['Chỉ có súng ngắn và shotgun', 'pistol', 'all', { loadout: 'single' }, 1],
    ['bắt đầu bằng súng ngắn, có shotgun và súng nặng', 'pistol', 'all'],
    ['dùng shotgun và súng xuyên', 'shotgun', 'all', { weapon: 'heavy' }],
    ['pistol, shotgun and cannon', 'pistol', 'all', { loadout: 'single' }],
    // none named
    ['Một màn bắn súng', 'pistol', 'all'],
    ['Một màn bắn súng', 'pistol', 'all', { loadout: 'single' }],
    ['chỉ có zombie', 'pistol', 'all'],
    ['chỉ có zombie', 'pistol', 'all', { loadout: 'single' }],
    ['Chỉ huy căn cứ quân sự', 'pistol', 'all', { loadout: 'single' }],
    ['chỉ huy quân đội chống zombie', 'rapid', 'all', { weapon: 'rapid' }],
    ['quái tấn công liên tục, sống sót 60 giây', 'pistol', 'all'],
    ['Quái tấn công liên tục, sống sót 60 giây', 'rapid', 'all', { weapon: 'rapid' }],
    ['quái tấn công liên tục', 'pistol', 'all', { loadout: 'single' }],
    ['chỉ có một loại súng', 'pistol', 'single'],
    ['chỉ có một loại súng', 'heavy', 'single', { weapon: 'heavy' }],
    ['chỉ dùng 1 loại súng', 'pistol', 'single'],
    ['không được đổi súng', 'pistol', 'single'],
    ['không thể chuyển súng', 'pistol', 'single'],
    ['no weapon switching', 'pistol', 'single'],
    ['one weapon only', 'pistol', 'single'],
    ['súng cố định', 'pistol', 'single'],
    ['Hạ 40 zombie trong thành phố', 'pistol', 'all'],
    ['a sniper rifle level', 'pistol', 'all'],
    ['heavyweight boxing', 'pistol', 'all'],
    ['only zombies', 'pistol', 'all', { loadout: 'single' }],
    ['single player', 'pistol', 'all'],
    ['bảo vệ căn cứ có boss cuối', 'pistol', 'all', { loadout: 'single' }],
    ['', 'pistol', 'all'],
  ];

  it('has at least 60 examples', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(60);
  });

  it.each(CASES.map((c, i) => [i, ...c] as const))('#%i %s', (_i, prompt, weapon, loadout, model, notices) => {
    const result = guard(prompt, model);
    expect({ weapon: result.brief.weapon, loadout: result.brief.loadout }, `${prompt} (model ${JSON.stringify(model ?? {})})`).toEqual({ weapon, loadout });
    expect(result.notices, prompt).toHaveLength(notices ?? 0);
  });

  it('says in a notice, for a limit to several weapons, what the engine does instead, naming the start in Vietnamese', () => {
    expect(guard('Chỉ có súng ngắn và shotgun').notices).toEqual([SEVERAL_WEAPONS_NOTICE('pistol')]);
    expect(SEVERAL_WEAPONS_NOTICE('pistol')).toBe('Chưa hỗ trợ: chỉ giữ một vài súng; màn có đủ 5 súng, bắt đầu bằng súng ngắn.');
    expect(guard('only heavy or smg', { weapon: 'rapid' }).notices).toEqual(['Chưa hỗ trợ: chỉ giữ một vài súng; màn có đủ 5 súng, bắt đầu bằng súng bắn nhanh (liên thanh).']);
    expect(SEVERAL_WEAPONS_NOTICE('shotgun')).toContain('shotgun (súng săn)');
    for (const note of ['pistol', 'shotgun', 'piercing', 'rapid', 'heavy'] as const) expect(SEVERAL_WEAPONS_NOTICE(note).length).toBeLessThanOrEqual(160);
  });

  it('writes down every change as {field, from, to}, and nothing when the model was already right', () => {
    expect(guard('chỉ có súng ngắn', { weapon: 'shotgun', loadout: 'single' }).changed).toEqual([{ field: 'weapon', from: 'shotgun', to: 'pistol' }]);
    expect(guard('chỉ có súng liên tục', { weapon: 'rapid', loadout: 'all' }).changed).toEqual([{ field: 'loadout', from: 'all', to: 'single' }]);
    expect(guard('chỉ có súng ngắn', { weapon: 'rapid', loadout: 'all' }).changed).toEqual([{ field: 'weapon', from: 'rapid', to: 'pistol' }, { field: 'loadout', from: 'all', to: 'single' }]);
    expect(guard('chỉ có súng ngắn', { weapon: 'pistol', loadout: 'single' }).changed).toEqual([]);
    expect(guard('một màn bắn súng').changed).toEqual([]);
    // the brief is the same object when nothing changed
    const brief = { weapon: 'pistol', loadout: 'all' };
    expect(guardWeapons(brief, 'zombie').brief).toBe(brief);
  });

  it('does not touch other fields of the brief', () => {
    const brief = { weapon: 'heavy', loadout: 'single', theme: 'ice-base', unsupported: ['x'] };
    const guarded = guardWeapons(brief, 'Một màn bắn súng').brief;
    expect(guarded).toEqual({ weapon: 'heavy', loadout: 'all', theme: 'ice-base', unsupported: ['x'] });
  });

  it('knows the two kinds of limit word', () => {
    for (const text of ['mot loai sung', '1 loai sung', 'khong duoc doi sung', 'khong the chuyen sung', 'khong doi sung', 'co dinh sung', 'sung co dinh', 'one weapon', 'no weapon switching', 'no weapon changing']) expect(LIMIT_PHRASES.test(text), text).toBe(true);
    for (const text of ['chi co', 'chi dung', 'chi duoc', 'chi xai', 'duy nhat', 'only', 'just a', 'just the', 'single']) expect(LIMIT_WORDS.test(text), text).toBe(true);
    for (const text of ['chi huy', 'chi cong', 'onlyfans', 'singles', 'sung ngan']) { expect(LIMIT_WORDS.test(text), text).toBe(false); expect(LIMIT_PHRASES.test(text), text).toBe(false); }
  });
});

describe('the other guards keep their behavior (health drops and base)', () => {
  it('still takes out health drops and a base the text never asked for, and nothing else', () => {
    expect(guardUnrequested({ healthDrops: 'some', base: 'defend' }, 'một màn bắn súng')).toEqual({ brief: { healthDrops: 'none', base: 'none' }, removed: ['healthDrops', 'base'] });
    expect(guardUnrequested({ healthDrops: 'some', base: 'defend' }, 'bảo vệ căn cứ, có hộp máu')).toEqual({ brief: { healthDrops: 'some', base: 'defend' }, removed: [] });
    const withLoadout = guardUnrequested({ healthDrops: 'none', base: 'none', loadout: 'single' }, 'một màn bắn súng');
    expect(withLoadout.brief.loadout).toBe('single'); // the weapons are no longer this guard's business
    expect(withLoadout.removed).toEqual([]);
  });
});

describe('through the service: a wrong answer of the model is put right, and the diagnostics say how', () => {
  const answer = (patch: Record<string, unknown>) => ({
    version: 'brief-1', healthDrops: 'none', boss: 'none', base: 'none', enemyFamily: 'auto', loadout: 'all', title: 'Súng', theme: 'zombie-city', map: 'open-arena',
    enemies: [{ type: 'runner', share: 5 }], intensity: 1, playerHealth: 'normal', weapon: 'pistol', goal: { type: 'survive', seconds: 60 }, unsupported: [], ...patch,
  });
  const setup = (prompt: string, reply: Record<string, unknown>) => {
    const finished: DiagnosticsFinish[] = [];
    const gateway = new AiGateway(mockRegistry([mockProvider('groq', async () => JSON.stringify(reply))]));
    const service = new ShooterService(gateway, {
      compile: async (job) => compileAndGate(job), seed: () => 11,
      openDiagnostics: async () => ({ async note() {}, async raw() {}, async finish(record) { finished.push(record); } }),
    });
    return { run: () => service.generate({ prompt, providerId: 'groq' }, 'test', new AbortController().signal), finished };
  };

  it('"chỉ có súng ngắn" with shotgun and single: a pistol level with one weapon', async () => {
    const { run, finished } = setup('Chỉ có súng ngắn, hạ 40 zombie', answer({ weapon: 'shotgun', loadout: 'single', goal: { type: 'kill', count: 40 } }));
    const project = await run();
    expect(project.level.weapon).toEqual(PRESETS.pistol);
    expect('arsenal' in project.level).toBe(false);
    expect(project.notices.join(' ')).not.toMatch(/súng|vũ khí/);
    expect((finished[0]!.report as { guardChanged?: unknown }).guardChanged).toEqual([{ field: 'weapon', from: 'shotgun', to: 'pistol' }]);
  });

  it('"chỉ có súng liên tục" with all: a rapid level with one weapon', async () => {
    const { run, finished } = setup('Chỉ có súng liên tục, sống sót 60 giây', answer({ weapon: 'rapid', loadout: 'all' }));
    const project = await run();
    expect(project.level.weapon).toEqual(PRESETS.rapid);
    expect('arsenal' in project.level).toBe(false);
    expect((finished[0]!.report as { guardChanged?: unknown }).guardChanged).toEqual([{ field: 'loadout', from: 'all', to: 'single' }]);
  });

  it('"chỉ có súng ngắn và shotgun": all five weapons, the one notice, starting with the pistol', async () => {
    const { run } = setup('Chỉ có súng ngắn và shotgun', answer({ weapon: 'pistol', loadout: 'single' }));
    const project = await run();
    expect(project.level.arsenal).toHaveLength(5);
    expect(project.notices).toContain(SEVERAL_WEAPONS_NOTICE('pistol'));
  });

  it('"quái tấn công liên tục": not taken for a gun, and nothing is written down', async () => {
    const { run, finished } = setup('Quái tấn công liên tục, sống sót 60 giây', answer({ weapon: 'pistol', loadout: 'all' }));
    const project = await run();
    expect(project.level.weapon).toEqual(PRESETS.pistol);
    expect(project.level.arsenal).toHaveLength(5);
    expect(finished[0]!.report).not.toHaveProperty('guardChanged');
  });

  it('writes only field, from and to in the diagnostics: no text of the prompt, no key, nothing personal', async () => {
    const { run, finished } = setup('Chỉ có súng ngắn, anh Nam ở đường Lê Lợi muốn hạ 40 zombie', answer({ weapon: 'shotgun', loadout: 'single' }));
    await run();
    const changed = (finished[0]!.report as { guardChanged: Array<Record<string, unknown>> }).guardChanged;
    for (const entry of changed) expect(Object.keys(entry).sort()).toEqual(['field', 'from', 'to']);
    const text = JSON.stringify(changed);
    expect(text).not.toMatch(/Nam|Lê Lợi|zombie|key|token|secret/i);
  });

  it('the schema still accepts what the guard returns', () => {
    const guarded = guard('chỉ có súng liên thanh', { weapon: 'pistol', loadout: 'all' }).brief;
    expect(ShooterBriefSchema.safeParse({ ...answer({}), ...guarded }).success).toBe(true);
  });
});
