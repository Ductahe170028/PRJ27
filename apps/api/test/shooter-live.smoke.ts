// Opt-in diagnostic: real Groq requests through the shooter service (brief ->
// compiler -> bot gate). Never run by `npm test` or E2E.
//
//   npx tsx test/shooter-live.smoke.ts --live [--rounds=2] [--only=abc] [--set=stage3]
//
// The key is read from apps/api/.env (git-ignored) exactly like the server does,
// and is never printed or written anywhere. Requests go one after the other and
// keep to AI_REQUESTS_PER_MINUTE / AI_REQUESTS_PER_DAY; the Groq pacing of
// GameGenerationService waits when the minute is used up. No retry here: a
// failed run is reported as it is. If the day's limit is reached the run stops.
import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { createProviderRegistry } from '../src/providers/create-registry.js';
import { AIError } from '../src/providers/errors.js';
import { GameGenerationService } from '../src/services/game-generation-service.js';
import { RequestBudget } from '../src/services/request-budget.js';
import { openStandardDiagnostics, type StandardFinish } from '../src/services/standard-diagnostics.js';
import { ShooterService } from '../src/shooter/service.js';

if (!process.argv.includes('--live')) throw new Error('Use --live to explicitly enable real Groq requests.');
const env = { ...parse(await readFile(new URL('../.env', import.meta.url), 'utf8')), ...process.env };
if (!env.GROQ_API_KEY) throw new Error('Missing GROQ_API_KEY in apps/api/.env.');
const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const rounds = Number(arg('rounds') ?? 2);
const only = arg('only');
const limit = (name: string, fallback: number) => Number(env[name] || fallback);

// --set=stage3 runs the short prompts of the Stage 3 check instead of the default set.
const STAGE3_PROMPTS: ReadonlyArray<[string, string]> = [
  ['a', 'zombie thành phố 60 giây'],
  ['b', 'alien lab, hạ 40 con'],
  ['c', 'rừng tối, súng bắn nhanh'],
  ['d', 'bệnh viện, zombie chậm, 90 giây'],
  ['e', 'bảo vệ căn cứ'],
  ['f', 'boss cuối và hồi máu'],
  ['g', 'tên lửa nổ lan'],
  ['h', 'three enemy types, 120 seconds, military base'],
  ['i', 'không có quái nhưng hạ 50 quái'],
  ['j', 'hạ 200 con quái trâu'],
];
const DEFAULT_PROMPTS: ReadonlyArray<[string, string]> = [
  ['a', 'Tạo game bắn zombie sinh tồn trong thành phố, sống sót 60 giây.'],
  ['b', 'Quái ngoài hành tinh tấn công phòng thí nghiệm, tôi phải hạ 40 con.'],
  ['c', 'Khu rừng đầy quái vật, tôi dùng súng bắn nhanh.'],
  ['d', 'Bệnh viện bỏ hoang, zombie đi chậm nhưng ra liên tục, sống sót 90 giây.'],
  ['e', 'Bảo vệ căn cứ trước các đợt tấn công của quái vật.'],
  ['f', 'Game bắn súng có boss cuối và vật phẩm hồi máu.'],
  ['g', 'Súng bắn tên lửa nổ lan, hạ gục cả đám quái.'],
  ['h', 'A military base shooter with three kinds of enemies: fast ones, tough ones and swarms. Survive for two minutes.'],
  ['i', 'zombie'],
  ['j', 'Không có quái nhưng phải hạ 50 quái.'],
];
const PROMPTS = arg('set') === 'stage3' ? STAGE3_PROMPTS : DEFAULT_PROMPTS;

const captured: { record: StandardFinish | undefined } = { record: undefined };
const lastRecord = () => captured.record; // read through a function: it is set inside a callback
const generation = new GameGenerationService(createProviderRegistry(env), new RequestBudget({
  requestsPerMinute: limit('AI_REQUESTS_PER_MINUTE', 5), requestsPerDay: limit('AI_REQUESTS_PER_DAY', 100), maxConcurrent: limit('AI_MAX_CONCURRENT', 2),
}), limit('AI_TIMEOUT_MS', 45_000));
const shooter = new ShooterService(generation, {
  // The real diagnostics (under .local-diagnostics, redacted) plus a copy of the final record for this report.
  openDiagnostics: async (input) => {
    const real = await openStandardDiagnostics(input);
    return { note: (exchange) => real.note(exchange), raw: (text) => real.raw(text), finish: (record) => { captured.record = record; return real.finish(record); } };
  },
});

let stopped: string | undefined;
let done = 0;
const rows: unknown[] = [];
outer: for (let round = 1; round <= rounds; round += 1) {
  for (const [id, prompt] of PROMPTS) {
    if (only && !only.includes(id)) continue;
    captured.record = undefined;
    const started = Date.now();
    const row: Record<string, unknown> = { prompt: id, round };
    try {
      const project = await shooter.generate({ prompt, providerId: 'groq' }, 'live-smoke', new AbortController().signal);
      const brief = lastRecord()?.normalized as Record<string, unknown> | undefined;
      Object.assign(row, {
        ok: true, title: project.title, notices: project.notices,
        brief: brief && { theme: brief.theme, map: brief.map, enemies: brief.enemies, intensity: brief.intensity, playerHealth: brief.playerHealth, weapon: brief.weapon, goal: brief.goal, unsupported: brief.unsupported },
        level: { obstacles: project.level.obstacles.length, spawnPoints: project.level.spawnPoints.length, waves: project.level.waves.length, enemies: project.level.waves.reduce((sum, wave) => sum + wave.count, 0), hp: project.level.player.hp, win: project.level.win },
        compile: lastRecord()?.report,
      });
    } catch (error) {
      const known = error instanceof AIError;
      Object.assign(row, {
        ok: false, code: known ? error.code : 'internal', message: known ? error.message : 'Lỗi không phải AIError.',
        ...(known && error.issues?.length ? { issues: error.issues } : {}),
        brief: (lastRecord()?.normalized ?? lastRecord()?.parsed) ?? null,
      });
      // The day's limit (ours or Groq's): stop here, do not force it.
      if (known && error.code === 'rate_limit' && (error.retryAfterSeconds ?? 0) > 900) stopped = `${error.code}: ${error.message}`;
    }
    row.ms = Date.now() - started;
    rows.push(row);
    done += 1;
    console.log(JSON.stringify(row));
    if (stopped) break outer;
  }
}
const ok = rows.filter((row) => (row as { ok: boolean }).ok).length;
console.log(JSON.stringify({ summary: { runs: done, ok, failed: done - ok, stoppedAtLimit: stopped ?? null } }));
