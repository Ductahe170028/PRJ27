// Offline calibration of INTENSITY_RATE (apps/api/src/shooter/waves.ts) and of the casual bot (CASUAL).
//
//   npx tsx scripts/calibrate-shooter.ts                      run the grid with the casual bot (the gate's bot), print the tables
//   ... --bot=expert                                          the same grid with the expert bot (botInput; the gate's bot before Stage 4A)
//   ... --casual=reaction=12,aim=5,flee=0.8,wall=0.5,fire=0.85   try other casual-bot numbers without editing CASUAL
//   ... --pre-only                                            only the bot on the raw compiled levels (fast, for tuning)
//   ... --goal=survive:180 | --goal=kill:100 | --seeds=1      another goal / fewer seeds
//   ... --out=path.txt                                        also write the tables to that file
//
// The grid: intensity 1-5 x enemy mix (runner, brute, swarmer, all three) x map (5)
// x weapon (3) x health (3) x 3 seeds = 2700 games per phase. "Before the gate"
// is the bot on the level exactly as compiled; "after the gate" is the level the
// service would hand out (compile + gate), played on seeds the gate did not use.
// PowerShell swallows flags passed through npm: run `npx tsx scripts/calibrate-shooter.ts --write`
// directly from apps/api. Never run by `npm test`. It runs in parallel child processes, one shard each.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CASUAL, botInput, createCasualBot, playLevel, type CasualParams, type ShooterLevel } from '@game-creator/contracts';
import { ShooterBriefSchema, SHOOTER_MAPS, PLAYER_HEALTHS, WEAPONS, type ShooterBrief } from '../src/shooter/brief.js';
import { compileShooter } from '../src/shooter/compile.js';
import { compileAndGate } from '../src/shooter/compile-job.js';
import { INTENSITY_RATE } from '../src/shooter/waves.js';

const MIXES: ReadonlyArray<{ name: string; enemies: ShooterBrief['enemies'] }> = [
  { name: 'runner', enemies: [{ type: 'runner', share: 5 }] },
  { name: 'brute', enemies: [{ type: 'brute', share: 5 }] },
  { name: 'swarmer', enemies: [{ type: 'swarmer', share: 5 }] },
  { name: 'mixed', enemies: [{ type: 'runner', share: 4 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 4 }] },
];
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

interface Combo { intensity: number; mix: string; map: string; weapon: string; health: string; seed: number }
interface Row {
  combo: Combo;
  preWon: boolean; preHp: number;
  postOk: boolean; postWon: boolean; postHp: number; thin: number; reduced: boolean; error?: string;
}

function* grid(): Generator<{ combo: Combo; brief: ShooterBrief }> {
  for (const intensity of [1, 2, 3, 4, 5]) for (const mix of MIXES) for (const map of SHOOTER_MAPS) {
    for (const weapon of WEAPONS) for (const health of PLAYER_HEALTHS) for (const seed of SEEDS.slice(0, seedCount)) {
      const brief = ShooterBriefSchema.parse({
        version: 'brief-1', title: 'Calibration', theme: 'zombie-city', map, enemies: mix.enemies, intensity,
        playerHealth: health, weapon, goal: GOAL, unsupported: [],
      });
      yield { combo: { intensity, mix: mix.name, map, weapon, health, seed }, brief };
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
    if (!preOnly) {
      try {
        const job = compileAndGate({ brief, seed: combo.seed }, { play: playWith });
        const post = playWith({ ...job.level, seed: job.level.seed + 11 });
        Object.assign(row, { postOk: true, postWon: post.status === 'won', postHp: post.hpLeft, thin: job.report.thinSteps, reduced: job.report.killReductions > 0 });
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
  lines.push(`bot: ${botDescription()}`, `INTENSITY_RATE = [${INTENSITY_RATE.join(', ')}]`, `goal: ${JSON.stringify(GOAL)}`, '');
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
  return lines.join('\n');
}

const args = process.argv.slice(2);
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
    const child = spawn(process.execPath, [...process.execArgv, script, `--shard=${index}/${shards}`, ...(preOnly ? ['--pre-only'] : []), ...args.filter((arg) => /^--(seeds|goal|bot|casual)=/.test(arg))], { stdio: ['ignore', 'pipe', 'inherit'] });
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
