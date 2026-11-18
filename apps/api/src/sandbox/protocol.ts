import { GamePlanSchema, type GamePlan } from '@game-creator/contracts';

/** Backend <-> container protocol. The job travels over stdin and the result
 * over stdout. Nothing from the Host filesystem is mounted into the container. */
export const SANDBOX_PROTOCOL_VERSION = 1;
const JAVASCRIPT_MAX_CHARS = 65_536;
const REQUEST_MAX_CHARS = 2_000;
/** javascript (<=64 KB, up to 4 bytes per char in JSON escapes) + plan + request. */
export const SANDBOX_MAX_INPUT_BYTES = 320 * 1024;
export const SANDBOX_MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_ERRORS = 10;
const MAX_ERROR_CHARS = 500;

export interface SandboxJob { version: typeof SANDBOX_PROTOCOL_VERSION; javascript: string; plan: GamePlan; request: string }
export type SandboxFailureCode = 'tester_unavailable' | 'internal';
export type SandboxResult =
  | { version: typeof SANDBOX_PROTOCOL_VERSION; ok: true; errors: string[] }
  | { version: typeof SANDBOX_PROTOCOL_VERSION; ok: false; code: SandboxFailureCode; message: string };

export class SandboxInputError extends Error {}

export function encodeJob(javascript: string, plan: GamePlan, request: string): string {
  if (javascript.length < 1 || javascript.length > JAVASCRIPT_MAX_CHARS) throw new SandboxInputError('Game vượt giới hạn kích thước kiểm thử.');
  if (request.length > REQUEST_MAX_CHARS) throw new SandboxInputError('Mô tả vượt giới hạn kích thước kiểm thử.');
  const text = JSON.stringify({ version: SANDBOX_PROTOCOL_VERSION, javascript, plan, request } satisfies SandboxJob);
  if (Buffer.byteLength(text, 'utf8') > SANDBOX_MAX_INPUT_BYTES) throw new SandboxInputError('Dữ liệu kiểm thử vượt giới hạn.');
  return text;
}

/** Runs inside the container. Treats the input as untrusted data. */
export function parseJob(text: string): SandboxJob {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null) throw new SandboxInputError('Job không hợp lệ.');
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record).sort().join();
  if (keys !== 'javascript,plan,request,version' || record.version !== SANDBOX_PROTOCOL_VERSION) throw new SandboxInputError('Job không hợp lệ.');
  const { javascript, request } = record;
  if (typeof javascript !== 'string' || javascript.length < 1 || javascript.length > JAVASCRIPT_MAX_CHARS) throw new SandboxInputError('Job không hợp lệ.');
  if (typeof request !== 'string' || request.length > REQUEST_MAX_CHARS) throw new SandboxInputError('Job không hợp lệ.');
  const plan = GamePlanSchema.safeParse(record.plan);
  if (!plan.success) throw new SandboxInputError('Job không hợp lệ.');
  return { version: SANDBOX_PROTOCOL_VERSION, javascript, plan: plan.data, request };
}

/** Runs on the host. The container is untrusted, so its output is validated
 * strictly and anything unexpected is rejected rather than interpreted. */
export function parseResult(text: string): SandboxResult | undefined {
  let raw: unknown;
  try { raw = JSON.parse(text.trim()); } catch { return undefined; }
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.version !== SANDBOX_PROTOCOL_VERSION) return undefined;
  if (record.ok === true) {
    if (Object.keys(record).sort().join() !== 'errors,ok,version') return undefined;
    const errors = record.errors;
    if (!Array.isArray(errors) || errors.length > MAX_ERRORS) return undefined;
    if (!errors.every((item) => typeof item === 'string' && item.length <= MAX_ERROR_CHARS)) return undefined;
    return { version: SANDBOX_PROTOCOL_VERSION, ok: true, errors: errors as string[] };
  }
  if (record.ok === false) {
    if (Object.keys(record).sort().join() !== 'code,message,ok,version') return undefined;
    if (record.code !== 'tester_unavailable' && record.code !== 'internal') return undefined;
    if (typeof record.message !== 'string') return undefined;
    return { version: SANDBOX_PROTOCOL_VERSION, ok: false, code: record.code, message: record.message.slice(0, 300) };
  }
  return undefined;
}
