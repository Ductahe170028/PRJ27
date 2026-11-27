// Offline calibration of INTENSITY_RATE (apps/api/src/shooter/waves.ts) and of the casual bot (CASUAL).
//
//   npx tsx scripts/calibrate-shooter.ts                      run the grid with the casual bot (the gate's bot), print the tables
//   ... --bot=expert                                          the same grid with the expert bot (botInput; the gate's bot before Stage 4A)
//   ... --casual=reaction=12,aim=5,flee=0.8,wall=0.5,fire=0.85   try other casual-bot numbers without editing CASUAL
//   ... --pre-only                                            only the bot on the raw compiled levels (fast, for tuning)
//   ... --goal=survive:180 | --goal=kill:100 | --seeds=1      another goal / fewer seeds
//   ... --tune=spitter.weight=2.5,spitter.hold=260,shotgun.cooldown=800,...   try other Stage 4B numbers for this run only (see applyTune)
//   ... --set=old|new|all|boss                                     old = the Stage 4A grid (3 old weapons x 4 old mixes, 2700 games);
//                                                             new = every game with a new weapon or a new mix; all = both (default);
//                                                             boss = the Stage 4C grid: 2 bosses x 5 weapons x mixed/runner/all4 (6750 games, survive 60 s)
//   ... --set=base                                            the Stage 4D grid: a base to defend, survive 60 s, 4 mixes (mixed, runner, brute, all4) x 5 weapons x 5 maps x 3 health;
//                                                             --goal=kill:40 and --boss=crusher|gunner are the two side slices; losses are split into "player died" and "base destroyed"
//   ... --out=path.txt                                        also write the tables to that file
//
// The grid: intensity 1-5 x enemy mix (runner, brute, swarmer, mixed; Stage 4B adds spitter and all4)
// x map (5) x weapon (pistol, rapid, heavy; Stage 4B adds shotgun and piercing) x health (3) x 3 seeds
// = 2700 games per phase for the old set. Health drops stay off here (the bots ignore pickups). "Before the gate"
// is the bot on the level exactly as compiled; "after the gate" is the level the
// service would hand out (compile + gate), played on seeds the gate did not use.
// PowerShell swallows flags passed through npm: run `npx tsx scripts/calibrate-shooter.ts --write`
// directly from apps/api. Never run by `npm test`. It runs in parallel child processes, one shard each.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { BASE_TUNING, CASUAL, ENEMY_TYPES, bossWaveOf, botInput, createCasualBot, playLevel, type CasualParams, type ShooterLevel } from '@game-creator/contracts';
import { ShooterBriefSchema, SHOOTER_MAPS, PLAYER_HEALTHS, WEAPONS, type ShooterBrief } from '../src/shooter/brief.js';
import { compileShooter } from '../src/shooter/compile.js';
import { compileAndGate } from '../src/shooter/compile-job.js';
import { BASE_HP_BY_INTENSITY, BASE_PLAYER, BOSS_HP_BY_INTENSITY, WEAPONS as WEAPON_PRESETS } from '../src/shooter/presets.js';
import { BOSS_TIMING, ENEMY_WEIGHT, INTENSITY_RATE, NOT_BEFORE } from '../src/shooter/waves.js';

const MIXES: ReadonlyArray<{ name: string; enemies: ShooterBrief['enemies'] }> = [
  { name: 'runner', enemies: [{ type: 'runner', share: 5 }] },
  { name: 'brute', enemies: [{ type: 'brute', share: 5 }] },
  { name: 'swarmer', enemies: [{ type: 'swarmer', share: 5 }] },
  { name: 'mixed', enemies: [{ type: 'runner', share: 4 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 4 }] },
  // Stage 4B
  { name: 'spitter', enemies: [{ type: 'spitter', share: 5 }] },
  { name: 'all4', enemies: [{ type: 'runner', share: 3 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 3 }, { type: 'spitter', share: 2 }] },
];
const OLD_MIXES = ['runner', 'brute', 'swarmer', 'mixed'];
const OLD_WEAPONS = ['pistol', 'rapid', 'heavy'];
const SET = /^--set=(old|new|all|boss|base)$/.exec(process.argv.slice(2).find((arg) => arg.startsWith('--set=')) ?? '')?.[1] ?? 'all';
const BOSS_MIXES = ['mixed', 'runner', 'all4'];
const BASE_MIXES = ['mixed', 'runner', 'brute', 'all4'];
// --boss=crusher|gunner: the boss side slice of --set=base
const BASE_BOSS = /^--boss=(crusher|gunner)$/.exec(process.argv.slice(2).find((arg) => arg.startsWith('--boss=')) ?? '')?.[1] as 'crusher' | 'gunner' | undefined;
const BOSSES = SET === 'boss' ? (['crusher', 'gunner'] as const) : SET === 'base' && BASE_BOSS ? ([BASE_BOSS] as const) : (['none'] as const);
const inSet = (mix: string, weapon: string) => (SET === 'base' ? BASE_MIXES.includes(mix) : SET === 'boss' ? BOSS_MIXES.includes(mix) : SET === 'all' || (SET === 'old') === (OLD_MIXES.includes(mix) && OLD_WEAPONS.includes(weapon)));
const SEEDS = [101, 202, 303];
// --goal=survive:180 or --goal=kill:100 measures another goal (the default grid is survive 60).
const goalArg = /^--goal=(survive|kill):(\d+)$/.exec(process.argv.slice(2).find((arg) => arg.startsWith('--goal=')) ?? '');
const GOAL: ShooterBrief['goal'] = goalArg ? (goalArg[1] === 'kill' ? { type: 'kill', count: Number(goalArg[2]) } : { type: 'survive', seconds: Number(goalArg[2]) }) : { type: 'survive', seconds: 60 };

// The bot that plays: --bot=casual (default) or --bot=expert; --casual=... overrides numbers of CASUAL.
const BOT = /^--bot=(casual|expert)$/.exec(process.argv.slice(2).find((arg) => arg.startsWith('--bot=')) ?? '')?.[1] ?? 'casual';
const CASUAL_KEYS = { reaction: 'reactionTicks', aim: 'aimErrorDeg', flee: 'fleeScale', wall: 'wallScale', fire: 'fireRangeShare' } as const;
function casualParams(): CasualParams {
  const params: CasualParams = { ...CASUAL };
  const text = process.argv.slice(2).find((arg) => arg.startsWith('--casual='))?.slice('--casual='.length) ?? '';
  for (const pair of text.split(',').filter(Boolean)) {
    const [key, value] = pair.split('=');
    const field = CASUAL_KEYS[key as keyof typeof CASUAL_KEYS];
    if (!field || value === undefined || !Number.isFinite(Number(value))) throw new Error(`--casual: unknown or bad "${pair}" (keys: ${Object.keys(CASUAL_KEYS).join(', ')})`);
    params[field] = Number(value);
  }
  return params;
}
const PARAMS = casualParams();
const botDescription = () => (BOT === 'expert' ? 'expert (botInput: exact sight, perfect aim)'
  : `casual (reaction ${PARAMS.reactionTicks} ticks, aim error ±${PARAMS.aimErrorDeg}°, fires within ${PARAMS.fireRangeShare * 100}% of range, flee ${PARAMS.fleeScale * 100}%, walls ${PARAMS.wallScale * 100}%)`);
/** One game with a fresh bot made from that game's seed. */
const playWith = (level: ShooterLevel) => playLevel(level, BOT === 'expert' ? botInput : createCasualBot(level.seed, PARAMS));

interface Combo { intensity: number; boss: string; mix: string; map: string; weapon: string; health: string; seed: number }
interface Row {
  combo: Combo;
  preWon: boolean; preHp: number;
  postOk: boolean; postWon: boolean; postHp: number; thin: number; reduced: boolean; error?: string;
  /** A boss game that was won before the gate: seconds from the boss appearing to its defeat. */
  bossSecs?: number;
  /** The boss's hit points in the level the gate handed out. */
  bossHpAfter?: number;
  /** Stage 4D: how the game before the gate was lost (undefined when won), the same after the gate, the base's hit points kept, and whether the empty arena replaced the map. */
  preLostBy?: string; postLostBy?: string; baseHpAfter?: number; simplified?: boolean;
}

function* grid(): Generator<{ combo: Combo; brief: ShooterBrief }> {
  for (const intensity of [1, 2, 3, 4, 5]) for (const boss of BOSSES) for (const mix of MIXES) for (const map of SHOOTER_MAPS) {
    for (const weapon of WEAPONS) for (const health of PLAYER_HEALTHS) for (const seed of SEEDS.slice(0, seedCount)) {
      if (!inSet(mix.name, weapon)) continue;
      const brief = ShooterBriefSchema.parse({
        version: 'brief-1', healthDrops: 'none', boss, base: SET === 'base' ? 'defend' : 'none', enemyFamily: 'auto', loadout: 'all', title: 'Calibration', theme: 'zombie-city', map, enemies: mix.enemies, intensity,
        playerHealth: health, weapon, goal: GOAL, unsupported: [],
      });
      yield { combo: { intensity, boss, mix: mix.name, map, weapon, health, seed }, brief };
    }
  }
}

function runShard(index: number, shards: number, preOnly: boolean): Row[] {
  const rows: Row[] = [];
  let n = 0;
  for (const { combo, brief } of grid()) {
    if (n++ % shards !== index) continue;
    const compiled = compileShooter(brief, combo.seed);
    const pre = playWith(compiled.level);
    const row: Row = { combo, preWon: pre.status === 'won', preHp: pre.hpLeft, postOk: false, postWon: false, postHp: 0, thin: 0, reduced: false };
    const bossWave = bossWaveOf(compiled.level);
    row.simplified = compiled.notices.some((notice) => notice.includes('đơn giản hóa'));
    if (pre.status === 'lost') row.preLostBy = pre.state.lostBy ?? 'player';
    if (bossWave && pre.status === 'won') row.bossSecs = pre.seconds - bossWave.atMs / 1000;
    if (!preOnly) {
      try {
        const job = compileAndGate({ brief, seed: combo.seed }, { play: playWith });
        const post = playWith({ ...job.level, seed: job.level.seed + 11 });
        if (post.status === 'lost') row.postLostBy = post.state.lostBy ?? 'player';
        if (job.level.base) row.baseHpAfter = job.level.base.hp;
        Object.assign(row, { postOk: true, postWon: post.status === 'won', postHp: post.hpLeft, thin: job.report.thinSteps, reduced: job.report.killReductions > 0, ...(job.report.bossHp !== undefined ? { bossHpAfter: job.report.bossHp } : {}) });
      } catch (error) {
        row.error = error instanceof Error ? error.message : String(error);
      }
    }
    rows.push(row);
  }
  return rows;
}

const pct = (part: number, whole: number) => (whole === 0 ? 0 : (100 * part) / whole);
const avg = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

function report(rows: Row[], preOnly: boolean): string {
  const lines: string[] = [];
  lines.push(`bot: ${botDescription()}`, `set: ${SET}${TUNE_TEXT ? `, tune: ${TUNE_TEXT}` : ''}`, `INTENSITY_RATE = [${INTENSITY_RATE.join(', ')}]`, `goal: ${JSON.stringify(GOAL)}`, '');
  lines.push(`| intensity | games | bot wins before gate | hp left before | ${preOnly ? '' : 'compiled after gate | bot wins after gate | hp left after | thinned | goal reduced |'}`.trimEnd());
  lines.push(`|---|---|---|---|${preOnly ? '' : '---|---|---|---|---|'}`);
  for (const intensity of [1, 2, 3, 4, 5]) {
    const set = rows.filter((row) => row.combo.intensity === intensity);
    const ok = set.filter((row) => row.postOk);
    const cells = [intensity, set.length, `${pct(set.filter((r) => r.preWon).length, set.length).toFixed(1)}%`, avg(set.map((r) => r.preHp)).toFixed(3)];
    if (!preOnly) {
      cells.push(`${pct(ok.length, set.length).toFixed(1)}%`, `${pct(ok.filter((r) => r.postWon).length, ok.length).toFixed(1)}%`, avg(ok.map((r) => r.postHp)).toFixed(3),
        set.filter((r) => r.thin > 0).length, set.filter((r) => r.reduced).length);
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }
  if (!preOnly) {
    const failed = rows.filter((row) => !row.postOk);
    lines.push('', `Combinations that did not compile after the gate: ${failed.length} of ${rows.length}.`);
    for (const row of failed.slice(0, 40)) lines.push(`- intensity ${row.combo.intensity}, ${row.combo.mix}, ${row.combo.map}, ${row.combo.weapon}, ${row.combo.health}, seed ${row.combo.seed}: ${row.error}`);
  }
  lines.push('', 'Before the gate, by weapon / health / map (bot wins):');
  for (const key of ['weapon', 'health', 'map', 'mix'] as const) {
    const values = [...new Set(rows.map((row) => row.combo[key]))];
    lines.push(`- ${key}: ${values.map((value) => `${value} ${pct(rows.filter((r) => r.combo[key] === value && r.preWon).length, rows.filter((r) => r.combo[key] === value).length).toFixed(0)}%`).join(', ')}`);
  }
  const weapons = [...new Set(rows.map((row) => row.combo.weapon))];
  const mixes = [...new Set(rows.map((row) => row.combo.mix))];
  const wins = (set: Row[]) => (set.length === 0 ? '-' : `${pct(set.filter((r) => r.preWon).length, set.length).toFixed(1)}%`);
  lines.push('', 'Before the gate, bot wins by weapon x intensity:', `| weapon | ${[1, 2, 3, 4, 5].map((i) => `I${i}`).join(' | ')} |`, `|---|${'---|'.repeat(5)}`);
  for (const weapon of weapons) lines.push(`| ${weapon} | ${[1, 2, 3, 4, 5].map((i) => wins(rows.filter((r) => r.combo.weapon === weapon && r.combo.intensity === i))).join(' | ')} |`);
  lines.push('', 'Before the gate, bot wins by enemy mix x intensity, pistol only:', `| mix | ${[1, 2, 3, 4, 5].map((i) => `I${i}`).join(' | ')} |`, `|---|${'---|'.repeat(5)}`);
  for (const mix of mixes) lines.push(`| ${mix} | ${[1, 2, 3, 4, 5].map((i) => wins(rows.filter((r) => r.combo.mix === mix && r.combo.weapon === 'pistol' && r.combo.intensity === i))).join(' | ')} |`);
  lines.push('', 'Before the gate, intensity 3, normal health, bot wins by enemy mix x weapon (the Stage 4B slice):', `| mix | ${weapons.join(' | ')} |`, `|---|${'---|'.repeat(weapons.length)}`);
  for (const mix of mixes) lines.push(`| ${mix} | ${weapons.map((weapon) => wins(rows.filter((r) => r.combo.mix === mix && r.combo.weapon === weapon && r.combo.intensity === 3 && r.combo.health === 'normal'))).join(' | ')} |`);
  if (!preOnly) {
    lines.push('', 'After the gate, by enemy mix (compiled / bot wins on unused seeds / games thinned, of n):');
    for (const mix of mixes) {
      const set = rows.filter((r) => r.combo.mix === mix);
      const ok = set.filter((r) => r.postOk);
      lines.push(`- ${mix}: ${pct(ok.length, set.length).toFixed(1)}% compiled, ${pct(ok.filter((r) => r.postWon).length, ok.length).toFixed(1)}% won, ${set.filter((r) => r.thin > 0).length} thinned of ${set.length}`);
    }
    lines.push('', 'After the gate, by weapon (compiled / bot wins on unused seeds / games thinned, of n):');
    for (const weapon of weapons) {
      const set = rows.filter((r) => r.combo.weapon === weapon);
      const ok = set.filter((r) => r.postOk);
      lines.push(`- ${weapon}: ${pct(ok.length, set.length).toFixed(1)}% compiled, ${pct(ok.filter((r) => r.postWon).length, ok.length).toFixed(1)}% won, ${set.filter((r) => r.thin > 0).length} thinned of ${set.length}`);
    }
  }
  if (SET === 'boss') {
    const bosses = [...new Set(rows.map((row) => row.combo.boss))];
    const mean = (values: number[]) => (values.length === 0 ? '-' : (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1));
    lines.push('', 'Boss levels, before the gate: bot wins by boss x intensity:', `| boss | ${[1, 2, 3, 4, 5].map((i) => `I${i}`).join(' | ')} |`, `|---|${'---|'.repeat(5)}`);
    for (const boss of bosses) lines.push(`| ${boss} | ${[1, 2, 3, 4, 5].map((i) => wins(rows.filter((r) => r.combo.boss === boss && r.combo.intensity === i))).join(' | ')} |`);
    lines.push('', 'Boss fight length (s from the boss appearing to its defeat, games won before the gate), by boss x weapon (all intensities / intensity 3):', `| boss | ${weapons.join(' | ')} |`, `|---|${'---|'.repeat(weapons.length)}`);
    for (const boss of bosses) {
      lines.push(`| ${boss} | ${weapons.map((weapon) => {
        const set = rows.filter((r) => r.combo.boss === boss && r.combo.weapon === weapon && r.bossSecs !== undefined);
        const third = set.filter((r) => r.combo.intensity === 3);
        return `${mean(set.map((r) => r.bossSecs!))} / ${mean(third.map((r) => r.bossSecs!))} (min ${set.length ? Math.min(...set.map((r) => r.bossSecs!)).toFixed(1) : '-'})`;
      }).join(' | ')} |`);
    }
    if (!preOnly) {
      lines.push('', 'After the gate, by boss x intensity (compiled / bot wins on unused seeds / games thinned of n / mean boss hit points kept):');
      for (const boss of bosses) {
        for (const i of [1, 2, 3, 4, 5]) {
          const set = rows.filter((r) => r.combo.boss === boss && r.combo.intensity === i);
          const ok = set.filter((r) => r.postOk);
          lines.push(`- ${boss} I${i}: ${pct(ok.length, set.length).toFixed(1)}% compiled, ${pct(ok.filter((r) => r.postWon).length, ok.length).toFixed(1)}% won, ${set.filter((r) => r.thin > 0).length} thinned of ${set.length}, boss hp ${mean(ok.filter((r) => r.bossHpAfter !== undefined).map((r) => r.bossHpAfter!))}`);
        }
      }
    }
  }
  if (SET === 'base') lines.push(...baseReport(rows, preOnly, weapons));
  return lines.join('\n');
}

/** Stage 4D: the targets, the two kinds of loss, the games the gate had to ease, and the maps that fell back to the empty arena. */
function baseReport(rows: Row[], preOnly: boolean, weapons: string[]): string[] {
  const lines: string[] = [];
  const TARGET: Record<number, string> = { 1: '>= 80', 2: '65-90', 3: '50-80', 4: '35-65', 5: '20-50' };
  lines.push('', `Base levels, knobs: BASE_HP_BY_INTENSITY = [${BASE_HP_BY_INTENSITY.join(', ')}], BASE_HIT_INTERVAL_MS = ${BASE_TUNING.hitIntervalMs}, TARGET_SWITCH_MARGIN = ${BASE_TUNING.targetSwitchMargin}, BOT_LEASH = ${BASE_TUNING.botLeash}, BASE_PLAYER_GAP = ${BASE_PLAYER.gap}`);
  lines.push('', 'Base levels, before the gate: bot wins vs the target, and how the lost games were lost (player died / base destroyed):', '| intensity | target % | bot wins % | lost | by player | by base | share by player | share by base |', '|---|---|---|---|---|---|---|---|');
  for (const i of [1, 2, 3, 4, 5]) {
    const set = rows.filter((r) => r.combo.intensity === i);
    const lost = set.filter((r) => !r.preWon);
    const byBase = lost.filter((r) => r.preLostBy === 'base').length;
    const byPlayer = lost.length - byBase;
    lines.push(`| ${i} | ${TARGET[i]} | ${pct(set.filter((r) => r.preWon).length, set.length).toFixed(1)} | ${lost.length} | ${byPlayer} | ${byBase} | ${pct(byPlayer, lost.length).toFixed(1)}% | ${pct(byBase, lost.length).toFixed(1)}% |`);
  }
  const pistol3 = rows.filter((r) => r.combo.intensity === 3 && r.combo.weapon === 'pistol' && !r.preWon);
  const base3 = pistol3.filter((r) => r.preLostBy === 'base').length;
  lines.push('', `Intensity 3, pistol, lost games: ${pistol3.length}, by base ${pct(base3, pistol3.length).toFixed(1)}%, by player ${pct(pistol3.length - base3, pistol3.length).toFixed(1)}% (each must be >= 15%)`);
  lines.push('', 'Base levels, before the gate, bot wins by weapon x intensity (and the share of losses by base):', `| weapon | ${[1, 2, 3, 4, 5].map((i) => `I${i}`).join(' | ')} |`, `|---|${'---|'.repeat(5)}`);
  for (const weapon of weapons) {
    lines.push(`| ${weapon} | ${[1, 2, 3, 4, 5].map((i) => {
      const set = rows.filter((r) => r.combo.weapon === weapon && r.combo.intensity === i);
      const lost = set.filter((r) => !r.preWon);
      return `${pct(set.filter((r) => r.preWon).length, set.length).toFixed(0)}% (base ${pct(lost.filter((r) => r.preLostBy === 'base').length, lost.length).toFixed(0)}%)`;
    }).join(' | ')} |`);
  }
  lines.push('', 'Maps that fell back to the empty arena (the base rules did not fit), by map:');
  for (const map of [...new Set(rows.map((r) => r.combo.map))]) {
    const set = rows.filter((r) => r.combo.map === map);
    lines.push(`- ${map}: ${pct(set.filter((r) => r.simplified).length, set.length).toFixed(1)}% simplified (${set.filter((r) => r.simplified).length} of ${set.length})`);
  }
  if (!preOnly) {
    lines.push('', 'Base levels, after the gate, by intensity (compiled / bot wins on unused seeds / games eased / mean base hit points kept / lost by base among lost):');
    for (const i of [1, 2, 3, 4, 5]) {
      const set = rows.filter((r) => r.combo.intensity === i);
      const ok = set.filter((r) => r.postOk);
      const lost = ok.filter((r) => !r.postWon);
      const hps = ok.filter((r) => r.baseHpAfter !== undefined).map((r) => r.baseHpAfter!);
      lines.push(`- I${i}: ${pct(ok.length, set.length).toFixed(1)}% compiled, ${pct(ok.filter((r) => r.postWon).length, ok.length).toFixed(1)}% won, ${pct(set.filter((r) => r.thin > 0).length, set.length).toFixed(1)}% eased (${set.filter((r) => r.thin > 0).length} of ${set.length}), base hp ${avg(hps).toFixed(1)}, lost by base ${lost.filter((r) => r.postLostBy === 'base').length} of ${lost.length}`);
    }
    const unwinnable = rows.filter((r) => !r.postOk && (r.error ?? '').length > 0);
    lines.push(`unwinnable_level or other build failure: ${pct(unwinnable.length, rows.length).toFixed(2)}% (${unwinnable.length} of ${rows.length})`);
  }
  return lines;
}

const args = process.argv.slice(2);

/** --tune=key=value,...: changes Stage 4B numbers for this run only, to try them before editing the files.
 * Keys: spitter.weight, spitter.notbefore, spitter.hold|sight|cooldown|speed|damage (its ranged data),
 * shotgun.cooldown|damage|range|pellets|spread, piercing.cooldown|damage|range|pierce|speed. */
const TUNE_TEXT = args.find((arg) => arg.startsWith('--tune='))?.slice('--tune='.length) ?? '';
function applyTune() {
  const ranged = ENEMY_TYPES.spitter.ranged as unknown as Record<string, number>;
  const shotgun = WEAPON_PRESETS.shotgun as Record<string, number | undefined>;
  const piercing = WEAPON_PRESETS.piercing as Record<string, number | undefined>;
  const crusherCharge = (ENEMY_TYPES.crusher.boss as unknown as { charge: { cycleMs: number; telegraphMs: number; speedScale: number } }).charge;
  const gunnerVolleys = (ENEMY_TYPES.gunner.boss as unknown as { volleys: Array<{ cooldownMs: number; bulletSpeed: number }> }).volleys;
  const targets: Record<string, () => (value: number) => void> = {
    'spitter.weight': () => (v) => { ENEMY_WEIGHT.spitter = v; },
    'spitter.notbefore': () => (v) => { NOT_BEFORE.spitter = v; },
    'spitter.hold': () => (v) => { ranged.holdRange = v; },
    'spitter.sight': () => (v) => { ranged.sightRange = v; },
    'spitter.cooldown': () => (v) => { ranged.cooldownMs = v; },
    'spitter.speed': () => (v) => { ranged.bulletSpeed = v; },
    'spitter.damage': () => (v) => { ranged.bulletDamage = v; },
    'shotgun.cooldown': () => (v) => { shotgun.cooldownMs = v; },
    'shotgun.damage': () => (v) => { shotgun.damage = v; },
    'shotgun.range': () => (v) => { shotgun.range = v; },
    'shotgun.pellets': () => (v) => { shotgun.pellets = v; },
    'shotgun.spread': () => (v) => { shotgun.spreadDeg = v; },
    'piercing.cooldown': () => (v) => { piercing.cooldownMs = v; },
    'piercing.damage': () => (v) => { piercing.damage = v; },
    'piercing.range': () => (v) => { piercing.range = v; },
    'piercing.pierce': () => (v) => { piercing.pierce = v; },
    'piercing.speed': () => (v) => { piercing.bulletSpeed = v; },
    // Stage 4C: the bosses (hit points, rush and volley cycles, bullet speeds, when the boss comes)
    'crusher.hp': () => (v) => { (ENEMY_TYPES.crusher as { hp: number }).hp = v; },
    'gunner.hp': () => (v) => { (ENEMY_TYPES.gunner as { hp: number }).hp = v; },
    'crusher.cycle': () => (v) => { crusherCharge.cycleMs = v; },
    'crusher.telegraph': () => (v) => { crusherCharge.telegraphMs = v; },
    'crusher.rush': () => (v) => { crusherCharge.speedScale = v; },
    'gunner.fan': () => (v) => { gunnerVolleys[0]!.cooldownMs = v; },
    'gunner.ring': () => (v) => { gunnerVolleys[1]!.cooldownMs = v; },
    'gunner.fanspeed': () => (v) => { gunnerVolleys[0]!.bulletSpeed = v; },
    'gunner.ringspeed': () => (v) => { gunnerVolleys[1]!.bulletSpeed = v; },
    'boss.at': () => (v) => { BOSS_TIMING.atShare = v; },
    // (not part of the allowed limits: only to measure a proposal)
    'boss.before': () => (v) => { BOSS_TIMING.beforePace = v; },
    'boss.after': () => (v) => { BOSS_TIMING.afterSeconds = v; },
    'boss.afterpace': () => (v) => { BOSS_TIMING.afterPace = v; },
    // Stage 4D: the base (the five knobs the prompt allows to change)
    'basehp.1': () => (v) => { BASE_HP_BY_INTENSITY[0] = v; },
    'basehp.2': () => (v) => { BASE_HP_BY_INTENSITY[1] = v; },
    'basehp.3': () => (v) => { BASE_HP_BY_INTENSITY[2] = v; },
    'basehp.4': () => (v) => { BASE_HP_BY_INTENSITY[3] = v; },
    'basehp.5': () => (v) => { BASE_HP_BY_INTENSITY[4] = v; },
    'base.hit': () => (v) => { BASE_TUNING.hitIntervalMs = v; },
    'base.margin': () => (v) => { BASE_TUNING.targetSwitchMargin = v; },
    'base.leash': () => (v) => { BASE_TUNING.botLeash = v; },
    'base.gap': () => (v) => { BASE_PLAYER.gap = v; },
    'bossmult.1': () => (v) => { BOSS_HP_BY_INTENSITY[0] = v; },
    'bossmult.2': () => (v) => { BOSS_HP_BY_INTENSITY[1] = v; },
    'bossmult.3': () => (v) => { BOSS_HP_BY_INTENSITY[2] = v; },
    'bossmult.4': () => (v) => { BOSS_HP_BY_INTENSITY[3] = v; },
    'bossmult.5': () => (v) => { BOSS_HP_BY_INTENSITY[4] = v; },
  };
  for (const pair of TUNE_TEXT.split(',').filter(Boolean)) {
    const [key, value] = pair.split('=');
    const target = targets[key ?? ''];
    if (!target || value === undefined || !Number.isFinite(Number(value))) throw new Error(`--tune: unknown or bad "${pair}" (keys: ${Object.keys(targets).join(', ')})`);
    target()(Number(value));
  }
}
applyTune();
const shardArg = /^--shard=(\d+)\/(\d+)$/.exec(args.find((arg) => arg.startsWith('--shard=')) ?? '');
const preOnly = args.includes('--pre-only');
const seedCount = Number(/^--seeds=(\d+)$/.exec(args.find((arg) => arg.startsWith('--seeds=')) ?? '')?.[1] ?? SEEDS.length);

if (shardArg) {
  // Child: run one shard and print its rows as one line of JSON.
  process.stdout.write(`${JSON.stringify(runShard(Number(shardArg[1]), Number(shardArg[2]), preOnly))}\n`);
} else {
  const shards = Math.max(1, Math.min(cpus().length - 1, 8));
  const script = fileURLToPath(import.meta.url);
  const started = Date.now();
  const rows = (await Promise.all(Array.from({ length: shards }, (_, index) => new Promise<Row[]>((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, script, `--shard=${index}/${shards}`, ...(preOnly ? ['--pre-only'] : []), ...args.filter((arg) => /^--(seeds|goal|bot|casual|set|tune|boss)=/.test(arg))], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(JSON.parse(out) as Row[]) : reject(new Error(`shard ${index} exited with ${code}`))));
  })))).flat();
  const text = report(rows, preOnly);
  console.log(text);
  console.log(`\n${rows.length} games per phase, ${shards} shards, ${((Date.now() - started) / 1000).toFixed(0)} s`);
  const out = args.find((arg) => arg.startsWith('--out='))?.slice('--out='.length);
  if (out) writeFileSync(out, `${text}

${rows.length} games per phase, ${shards} shards
`);
}
