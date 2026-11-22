// Offline calibration of INTENSITY_RATE (apps/api/src/shooter/waves.ts).
//
//   npm run shooter:calibrate -w @game-creator/api            run the grid, print the tables
//   ... -- --write                                            also write docs/shooter-calibration.md
//   ... -- --pre-only                                         only the bot on the raw compiled levels (fast, for tuning)
//
// The grid: intensity 1-5 x enemy mix (runner, brute, swarmer, all three) x map (5)
// x weapon (3) x health (3) x 3 seeds = 2700 games per phase. "Before the gate"
// is the bot on the level exactly as compiled; "after the gate" is the level the
// service would hand out (compile + gate), played on seeds the gate did not use.
// Never run by `npm test`. It runs in parallel child processes, one shard each.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { botInput, playLevel } from '@game-creator/contracts';
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

interface Combo { intensity: number; mix: string; map: string; weapon: string; health: string; seed: number }
interface Row {
  combo: Combo;
  preWon: boolean; preHp: number;
  postOk: boolean; postWon: boolean; postHp: number; thin: number; thicken: number; error?: string;
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
    const pre = playLevel(compiled.level, botInput);
    const row: Row = { combo, preWon: pre.status === 'won', preHp: pre.hpLeft, postOk: false, postWon: false, postHp: 0, thin: 0, thicken: 0 };
    if (!preOnly) {
      try {
        const job = compileAndGate({ brief, seed: combo.seed });
        const post = playLevel({ ...job.level, seed: job.level.seed + 11 }, botInput);
        Object.assign(row, { postOk: true, postWon: post.status === 'won', postHp: post.hpLeft, thin: job.report.thinSteps, thicken: job.report.thickenSteps });
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
  lines.push(`INTENSITY_RATE = [${INTENSITY_RATE.join(', ')}]`, `goal: ${JSON.stringify(GOAL)}`, '');
  lines.push(`| intensity | games | bot wins before gate | hp left before | ${preOnly ? '' : 'compiled after gate | bot wins after gate | hp left after | thinned | thickened |'}`.trimEnd());
  lines.push(`|---|---|---|---|${preOnly ? '' : '---|---|---|---|---|'}`);
  for (const intensity of [1, 2, 3, 4, 5]) {
    const set = rows.filter((row) => row.combo.intensity === intensity);
    const ok = set.filter((row) => row.postOk);
    const cells = [intensity, set.length, `${pct(set.filter((r) => r.preWon).length, set.length).toFixed(1)}%`, avg(set.map((r) => r.preHp)).toFixed(3)];
    if (!preOnly) {
      cells.push(`${pct(ok.length, set.length).toFixed(1)}%`, `${pct(ok.filter((r) => r.postWon).length, ok.length).toFixed(1)}%`, avg(ok.map((r) => r.postHp)).toFixed(3),
        set.filter((r) => r.thin > 0).length, set.filter((r) => r.thicken > 0).length);
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
    const child = spawn(process.execPath, [...process.execArgv, script, `--shard=${index}/${shards}`, ...(preOnly ? ['--pre-only'] : []), ...args.filter((arg) => arg.startsWith('--seeds=') || arg.startsWith('--goal='))], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(JSON.parse(out) as Row[]) : reject(new Error(`shard ${index} exited with ${code}`))));
  })))).flat();
  const text = report(rows, preOnly);
  console.log(text);
  console.log(`\n${rows.length} games per phase, ${shards} shards, ${((Date.now() - started) / 1000).toFixed(0)} s`);
  if (args.includes('--write')) {
    const date = new Date().toISOString().slice(0, 10);
    writeFileSync(new URL('../../../docs/shooter-calibration.md', import.meta.url), [
      '# Hiệu chỉnh mật độ quái của shooter', '',
      `Ngày chạy: ${date}. Kết quả của \`npm run shooter:calibrate -w @game-creator/api -- --write\` (${rows.length} ván mỗi pha, ${shards} tiến trình song song, ${((Date.now() - started) / 1000).toFixed(0)} s).`, '',
      'Lưới: intensity 1-5 x mix quái (runner, brute, swarmer, cả ba) x map (5) x weapon (3) x health (3) x 3 seed; mục tiêu sống sót 60 s.',
      '"Trước cổng" là bot chơi level đúng như compiler dựng; "sau cổng" là level service sẽ trả (compile + cổng), chơi trên seed mà cổng chưa dùng.', '',
      'Ngưỡng đặt ra cho trước cổng: thắng intensity 1 ≥ 95%, 2 ≥ 90%, 3 ≥ 80%, 4 ≥ 55%, 5 ≥ 35%; sau cổng: 100% tổ hợp compile được.', '',
      '```', text, '```', '',
      'Chạy lại: `npm run shooter:calibrate -w @game-creator/api` (thêm `-- --write` để ghi lại tệp này, `-- --pre-only` để chỉ đo trước cổng khi chỉnh `INTENSITY_RATE`). Không chạy trong `npm test`.', '',
    ].join('\n'));
  }
}
