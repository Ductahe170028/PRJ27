// Opt-in diagnostic: uses the configured Groq key; never run by npm test/E2E.
import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { AgentOrchestrator } from '../src/agent/orchestrator.js';
import { GameGenerationService } from '../src/services/game-generation-service.js';
import { createProviderRegistry } from '../src/providers/create-registry.js';
import type { AgentEvent } from '@game-creator/contracts';
import { groqErrorDetail, responseFormatDiagnostic, safeSchemaPath } from '../src/providers/groq-rate-limit.js';

if (!process.argv.includes('--live')) throw new Error('Use --live to explicitly enable real Groq requests.');
const simple = process.argv.includes('--simple');
const env = { ...parse(await readFile(new URL('../.env', import.meta.url), 'utf8')), ...process.env };
if (!env.GROQ_API_KEY) throw new Error('Missing GROQ_API_KEY in apps/api/.env.');
const root = new URL('../../../.local-diagnostics/', import.meta.url);
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
  const detail = groqErrorDetail(data);
  const format = responseFormatDiagnostic(payload.response_format);
  const quota: Record<string, number> = {};
  for (const name of ['Limit', 'Used', 'Requested']) {
    const match = new RegExp(`${name}[: ]+([\\d.]+)`, 'i').exec(typeof detail.message === 'string' ? detail.message : '');
    if (match) quota[name.toLowerCase()] = Number(match[1]);
  }
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { if (key.startsWith('x-ratelimit-') || key === 'retry-after') headers[key] = value; });
  const record = { stage, httpStatus: response.status, inputChars: payload.messages?.reduce((n, message) => n + message.content.length, 0),
    schemaChars: JSON.stringify(payload.response_format ?? {}).length, maxOutput: payload.max_completion_tokens,
    responseFormat: { type: format.type, name: format.name, strict: format.strict, schema: format.schema, unsupportedKeywords: format.unsupportedKeywords },
    usage: data.usage ?? null, headers, quota,
    ...(typeof detail.code === 'string' ? { errorCode: detail.code } : {}),
    ...(safeSchemaPath(detail.schema_path) ? { schemaPath: safeSchemaPath(detail.schema_path) } : {}),
    ...(typeof detail.schema_code === 'string' && detail.schema_code.length <= 80 ? { schemaCode: detail.schema_code } : {}),
    failedGenerationPresent: typeof detail.failed_generation === 'string',
    contentPresent: typeof data.choices?.[0]?.message?.content === 'string' && data.choices[0].message.content.length > 0 };
  console.log(JSON.stringify(record));
  return response;
};
const agent = new AgentOrchestrator(new GameGenerationService(createProviderRegistry(env)));
const flappy = process.argv.includes('--flappy');
const prompt = flappy
  ? 'Tạo game Flappy Bird 2D. Nhấn Space hoặc click để chim bay lên, có trọng lực khi thả phím. Các cặp ống di chuyển liên tục từ phải sang trái. Vượt qua mỗi cặp ống được 1 điểm. Va chạm với ống hoặc biên màn hình thì thua. Đạt 10 điểm thì thắng. Có nút Restart.'
  : simple
  ? 'Tạo game bắn máy bay đơn giản. Phím trái/phải di chuyển, Space bắn đạn lên trên. Kẻ địch bay xuống liên tục. Bắn trúng địch được 10 điểm, đủ 50 điểm thắng, máy bay chạm địch thì thua.'
  : 'Tạo game bắn máy bay đơn giản: di chuyển trái phải, Space bắn đạn, kẻ địch xuất hiện liên tục, va chạm, điểm số, boss và thắng/thua.';
const reservation = agent.reserve({ providerId: 'groq', prompt });
try {
  await agent.run(reservation.request, 'live-diagnostic', new AbortController().signal, (event) => {
    last = event;
    if (event.type === 'status') stage = event.stage;
    if (event.type === 'status' || event.type === 'log' || event.type === 'failed') console.log(JSON.stringify(event));
  });
  if (last?.type !== 'completed') process.exitCode = 1;
} finally {
  reservation.release();
  globalThis.fetch = nativeFetch;
  try {
    const latest = (await readFile(new URL('latest-advanced.txt', root), 'utf8')).trim();
    console.log(`[advanced] diagnostics .local-diagnostics/${latest}`);
  } catch { /* The run ended before a diagnostics directory was opened. */ }
}
