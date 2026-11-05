// Opt-in diagnostic: uses the configured Groq key; never run by npm test/E2E.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { AgentOrchestrator } from '../src/agent/orchestrator.js';
import { GameGenerationService } from '../src/services/game-generation-service.js';
import { createProviderRegistry } from '../src/providers/create-registry.js';
import type { AgentEvent } from '@game-creator/contracts';

if (!process.argv.includes('--live')) throw new Error('Use --live to explicitly enable real Groq requests.');
const simple = process.argv.includes('--simple');
const label = simple ? 'simple' : 'after';
const env = { ...parse(await readFile(new URL('../.env', import.meta.url), 'utf8')), ...process.env };
if (!env.GROQ_API_KEY) throw new Error('Missing GROQ_API_KEY in apps/api/.env.');
const root = new URL('../../../.local-diagnostics/', import.meta.url);
await mkdir(root, { recursive: true });
const measurements: Record<string, unknown>[] = [];
const outputs: Array<{ stage: string; content?: string }> = [];
const logs: string[] = [];
const nativeFetch = globalThis.fetch;
let stage = 'Planning';
let last: AgentEvent | undefined;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  // Diagnostics expose only counts and selected rate-limit headers, never keys,
  // request headers, prompt/source text or raw upstream error messages.
  const payload = JSON.parse(await request.clone().text()) as { messages?: Array<{ content: string }>; max_completion_tokens?: number; response_format?: unknown };
  const response = await nativeFetch(request);
  const data = await response.clone().json() as { usage?: unknown; choices?: Array<{ message?: { content?: string } }>; error?: { message?: string; code?: string } };
  const quota: Record<string, number> = {};
  for (const name of ['Limit', 'Used', 'Requested']) {
    const match = new RegExp(`${name}[: ]+([\\d.]+)`, 'i').exec(data.error?.message ?? '');
    if (match) quota[name.toLowerCase()] = Number(match[1]);
  }
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { if (key.startsWith('x-ratelimit-') || key === 'retry-after') headers[key] = value; });
  const record = { stage, httpStatus: response.status, inputChars: payload.messages?.reduce((n, message) => n + message.content.length, 0),
    schemaChars: JSON.stringify(payload.response_format ?? {}).length, maxOutput: payload.max_completion_tokens,
    usage: data.usage ?? null, headers, quota, ...(data.error?.code ? { errorCode: data.error.code } : {}) };
  measurements.push(record); console.log(JSON.stringify(record));
  const content = data.choices?.[0]?.message?.content;
  outputs.push(content === undefined ? { stage } : { stage, content });
  return response;
};
const agent = new AgentOrchestrator(new GameGenerationService(createProviderRegistry(env)));
const flappy = process.argv.includes('--flappy');
const prompt = flappy
  ? 'Tạo game Flappy Bird 2D. Nhấn Space hoặc click để chim bay lên, có trọng lực khi thả phím. Các cặp ống di chuyển liên tục từ phải sang trái. Vượt qua mỗi cặp ống được 1 điểm. Va chạm với ống hoặc biên màn hình thì thua. Đạt 10 điểm thì thắng. Có nút Restart.'
  : simple
  ? 'Tạo game bắn máy bay đơn giản. Phím trái/phải di chuyển, Space bắn đạn lên trên. Kẻ địch bay xuống liên tục. Bắn trúng địch được 10 điểm, đủ 50 điểm thắng, máy bay chạm địch thì thua.'
  : 'Tạo game bắn máy bay đơn giản: di chuyển trái phải, Space bắn đạn, kẻ địch xuất hiện liên tục, va chạm, điểm số, boss và thắng/thua.';
const outputLabel = flappy ? 'flappy' : label;
const reservation = agent.reserve({ providerId: 'groq', prompt });
try {
  await agent.run(reservation.request, 'live-diagnostic', new AbortController().signal, (event) => {
    last = event;
    if (event.type === 'status') stage = event.stage;
    if (event.type === 'log') logs.push(...event.lines);
    if (event.type === 'status' || event.type === 'log' || event.type === 'failed') console.log(JSON.stringify(event));
  });
  if (last?.type === 'completed') await writeFile(new URL(`groq-${outputLabel}-project.json`, root), JSON.stringify(last.project, null, 2));
  await writeFile(new URL(`groq-${outputLabel}.json`, root), JSON.stringify({ prompt, model: reservation.request.modelId, result: last?.type, measurements, logs }, null, 2));
  await writeFile(new URL(`groq-${outputLabel}-outputs.json`, root), JSON.stringify(outputs, null, 2));
  await writeFile(new URL(`groq-${outputLabel}-errors.json`, root), JSON.stringify({ result: last?.type, logs }, null, 2));
  const assembled = assemble([...outputs].reverse().find((item) => item.content)?.content);
  if (assembled) {
    const { narrowStateReads } = await import('../src/agent/state-narrowing.js');
    const narrowed = narrowStateReads(assembled);
    await writeFile(new URL(`groq-${outputLabel}-game.ts`, root), narrowed.source);
    await writeFile(new URL(`groq-${outputLabel}-notes.json`, root), JSON.stringify(narrowed.notes, null, 2));
  }
  if (last?.type !== 'completed') process.exitCode = 1;
} finally { reservation.release(); globalThis.fetch = nativeFetch; }

function assemble(content: string | undefined): string | undefined {
  if (!content) return undefined;
  try {
    const value = JSON.parse(content) as { source?: unknown; setup?: unknown; update?: unknown; helpers?: unknown };
    if (typeof value.source === 'string') return value.source;
    if (typeof value.setup === 'string' && typeof value.update === 'string') {
      const helpers = typeof value.helpers === 'string' ? value.helpers : '';
      return `function create(api: GameAPI): void {\n${value.setup}\n}\nfunction update(api: GameAPI, dt: number): void {\n${value.update}\n}\n${helpers}`;
    }
  } catch { /* The provider text was not a code object. */ }
  return undefined;
}
