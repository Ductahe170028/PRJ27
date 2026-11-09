import { CODE_MAX_BYTES, CodeSourceSchema, GamePlanSchema, type AgentRequest, type GamePlan } from '@game-creator/contracts';
import { GameGenerationService } from '../services/game-generation-service.js';
import { AIError, RequestCapacityError, StructuredOutputError } from '../providers/errors.js';
import { estimateInputTokens } from '../providers/groq-rate-limit.js';
import type { ProviderTelemetry } from '../providers/ai-provider.js';
import ts from 'typescript';
import { CODE_CONTRACT, PLAN_LIMITS, parseModelObject, readPart, repairHints } from './code-contract.js';
import { providerJsonSchema } from '../services/system-prompt.js';

const planSchema = { type: 'object', additionalProperties: false, required: ['title', 'summary', 'mechanics', 'movement', 'action', 'objective'], properties: {
  title: { type: 'string', minLength: 1, maxLength: 80 }, summary: { type: 'string', minLength: 1, maxLength: 500 },
  mechanics: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 160 } },
  movement: { type: 'string', enum: ['horizontal', 'vertical', 'free', 'none'] }, action: { type: 'string', enum: ['space', 'pointer', 'none'] }, objective: { type: 'string', minLength: 1, maxLength: 200 },
} };
const partProperties = {
  setup: { type: 'string', description: 'Body of create(api: GameAPI): void. Statements only; no enclosing function.' },
  update: { type: 'string', description: 'Body of update(api: GameAPI, dt: number): void. Statements only; no enclosing function.' },
  helpers: { type: 'string', description: 'Additional top-level functions with explicit parameter types, or empty string.' },
};
const partSchema = (keys: Array<keyof typeof partProperties>) => ({ type: 'object', additionalProperties: false, required: keys,
  properties: Object.fromEntries(keys.map((key) => [key, partProperties[key]])) });
const RULES = `${CODE_CONTRACT}
Implement ALL requested mechanics and counts. Keep code concise. Prefer <=8 state keys and literal constants for speed, size and color. Scoring must call api.addScore. Set hp after spawn when more than 1 life is intended. Ignore self-collision. A boss must be reachable and destroyable. Move every live shot on every frame, outside the input branch. Math: random/floor/ceil/round/abs/min/max/sqrt/sin/cos/atan2/hypot/PI only. <=160 objects and <=5000 checks/frame. No assets.`;

type Observer = (event: ProviderTelemetry) => void;
// Original request remains authoritative; omit duplicated display title/summary.
const brief = (request: AgentRequest, plan: GamePlan) => ({ request: request.prompt, mechanics: plan.mechanics, movement: plan.movement, action: plan.action, objective: plan.objective });
const observer = (onTelemetry?: Observer) => onTelemetry ? { onTelemetry } : {};

export class GamePlanner {
  constructor(private readonly generation: GameGenerationService) {}
  async plan(request: AgentRequest, client: string, signal: AbortSignal, onTelemetry?: Observer): Promise<GamePlan> {
    // Groq strict mode only accepts a JSON Schema subset. Length and item bounds
    // stay in GamePlanSchema; sending them as minLength/maxLength/minItems/maxItems
    // makes Groq return 400 json_validate_failed with no content and no failed_generation.
    const text = await this.generation.generateArtifact(request, { prompt: request.prompt, maxOutputTokens: 450, jsonSchema: providerJsonSchema(planSchema), ...observer(onTelemetry),
      systemPrompt: `Plan a small 960x540 game. JSON only, concise text in user language: title <=40 chars, summary one short sentence, 2-5 short mechanics, objective <=100 chars. Preserve ALL requested counts/features including boss/bullets. Colored shapes, <=160 objects, no external assets. Include reachable win/loss. movement/action describe real keyboard/Space/pointer input; at least one not none. ${PLAN_LIMITS}` }, client, signal);
    try {
      if (Buffer.byteLength(text) > 8192) throw new Error();
      const plan = GamePlanSchema.parse(JSON.parse(text));
      if (plan.movement === 'none' && plan.action === 'none') throw new Error();
      return plan;
    } catch (error) {
      if (error instanceof AIError) throw error;
      const issues = planIssues(error);
      const detail = issues.length ? ` JSON do model sinh không đúng contract: ${issues.join(', ')}.` : '';
      throw new AIError('invalid_code', `Provider không trả kế hoạch game tương tác hợp lệ.${detail} Đây không phải Groq từ chối schema. Hãy rút gọn yêu cầu hoặc chọn model khác trong Settings.`, 422);
    }
  }
}

function planIssues(error: unknown): string[] {
  if (typeof error !== 'object' || error === null || !('issues' in error)) return [];
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  return issues.slice(0, 5).flatMap((issue) => {
    if (typeof issue !== 'object' || issue === null) return [];
    const record = issue as { path?: unknown; keys?: unknown; code?: unknown };
    const path = Array.isArray(record.path) ? record.path.map(String).join('.') : '';
    const keys = Array.isArray(record.keys) ? record.keys.filter((key): key is string => typeof key === 'string').join(',') : '';
    const label = path || keys || (typeof record.code === 'string' ? record.code : '');
    return label ? [label.slice(0, 80)] : [];
  });
}

export class CodeGenerator {
  constructor(protected readonly generation: GameGenerationService) {}
  protected input(prompt: Record<string, unknown>, maxOutputTokens: number, onTelemetry?: Observer) {
    const context = Object.entries(prompt).map(([key, value]) => `${key.toUpperCase()}:\n${Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : JSON.stringify(value)}`).join('\n\n');
    return { prompt: context, systemPrompt: RULES, jsonSchema: partSchema(['setup', 'update', 'helpers']), maxOutputTokens, ...observer(onTelemetry) };
  }
  async generate(request: AgentRequest, plan: GamePlan, client: string, signal: AbortSignal, onTelemetry?: Observer): Promise<string> {
    try { return finish(await this.generation.generateArtifact(request, this.input({ ...brief(request, plan), task: 'Implement complete game logic in setup/update bodies; api and dt are already typed parameters. Do not declare dt, w or h.' }, 2400, onTelemetry), client, signal)); }
    catch (error) {
      const recovered = recoverStructuredOutput(error);
      if (recovered) return recovered;
      if (!(error instanceof RequestCapacityError)) throw error;
      return this.split(request, plan, client, signal, error.tokenLimit, [], onTelemetry);
    }
  }

  /** Split along an explicit code boundary, never cut arbitrary text/tokens.
   * The second part receives the exact state/entity setup; the assembled file
   * still goes through the existing compiler, policy and Chromium tester.
   */
  protected async split(request: AgentRequest, plan: GamePlan, client: string, signal: AbortSignal, limit: number, diagnostics: string[], onTelemetry?: Observer): Promise<string> {
    const ask = (context: Record<string, unknown>, desired: number, keys: Array<keyof typeof partProperties>) => {
      const input = this.input(context, desired, onTelemetry);
      input.jsonSchema = partSchema(keys);
      const available = limit - estimateInputTokens(input) - 128;
      if (available < 600) throw new RequestCapacityError(limit, estimateInputTokens(input), 600);
      input.maxOutputTokens = Math.min(desired, available);
      return this.generation.generateArtifact(request, input, client, signal);
    };
    const setup = parseParts(await ask({ ...brief(request, plan), diagnostics,
      task: 'Part 1/2: ONLY setup body. Initialize every numeric state key and player/entities required by the COMPLETE game. No update/helpers yet. Part 2 receives this exact setup.' }, 900, ['setup']), ['setup']).setup;
    if (!onlySetup(`function create(api: GameAPI): void {\n${setup}\n}`)) throw new AIError('invalid_code', 'Phần khởi tạo game không hợp lệ; không ghép hoặc chạy code thiếu.', 422);
    const rest = parseParts(await ask({ ...brief(request, plan), diagnostics, setup,
      task: 'Part 2/2: ONLY update body and helpers. Implement ALL gameplay, using the exact state keys/entity kinds in setup. Do NOT repeat setup.' }, 2200, ['update', 'helpers']), ['update', 'helpers']);
    return finish(JSON.stringify({ setup, ...rest }));
  }
}

function onlySetup(source: string): boolean {
  try {
    const tree = ts.createSourceFile('setup.ts', source, ts.ScriptTarget.ES2022, true);
    return tree.statements.length === 1 && tree.statements.every((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'create' && Boolean(node.body));
  } catch { return false; }
}

export class CodeRepairAgent extends CodeGenerator {
  async repair(request: AgentRequest, plan: GamePlan, source: string, diagnostics: string[], client: string, signal: AbortSignal, onTelemetry?: Observer): Promise<string> {
    const errors = [...new Set(diagnostics)].slice(0, 5).map((line) => line.slice(0, 240));
    const rejected = source.includes('"generationError"');
    const input = this.input({ ...brief(request, plan), ...(rejected ? {} : { source }), diagnostics: errors, fixes: repairHints(errors),
      task: rejected
        ? 'SOURCE was rejected before TypeScript compile. Do not echo the error. Write complete setup/update bodies from the plan and the system contract.'
        : 'Fix ONLY the listed errors in the current source. A number | undefined error is one expression, not an array and not a reason to rewrite the game. Do not assign true, false, undefined or null to api.state; use 1 and 0. A helper is function spawnPipe(api: GameAPI): void and cannot see setup locals: read const gap = api.state.gap ?? 0. Compare e.kind only with a string passed to spawn; top pipe is upperPipe, bottom is lowerPipe, score only upperPipe. Never name a local top. Entity[] has no forEach. Entity has no extra fields such as scored. Spawn width and height are 1..200; stack a taller pipe, do not Math.min a height that can be below 1. Flap with if (api.input.action || api.input.pointerDown) { player.vy = -300; } Parenthesize ?? as (api.state.pipeInterval ?? 0). SOURCE is the assembled file; return statement bodies, not function create/update wrappers. Do not declare dt, w or h. Never write const dt=dt. Do not invent API members or state arrays. Keep mechanics that are not listed as errors.' }, 2400, onTelemetry);
    try { return finish(await this.generation.generateArtifact(request, input, client, signal)); }
    catch (error) {
      const recovered = recoverStructuredOutput(error);
      if (recovered) return recovered;
      if (!(error instanceof RequestCapacityError)) throw error;
      // Oversized broken source is not repeatedly resent or silently truncated.
      // Rebuild from the original requirements in two cooperating code parts.
      return this.split(request, plan, client, signal, error.tokenLimit, errors, onTelemetry);
    }
  }
}

function recoverStructuredOutput(error: unknown): string | undefined {
  if (!(error instanceof StructuredOutputError) || !error.failedGeneration) return undefined;
  try { return finish(error.failedGeneration); }
  catch { /* Groq may reject a missing helpers field or an extra key while the parts are still usable. */ }
  try {
    const fields = parseModelObject(error.failedGeneration);
    if (typeof fields.setup !== 'string' || typeof fields.update !== 'string') return undefined;
    const helpers = typeof fields.helpers === 'string' ? fields.helpers : '';
    return finish(JSON.stringify({ setup: fields.setup, update: fields.update, helpers }));
  } catch { return undefined; }
}

function parseParts<K extends keyof typeof partProperties>(text: string, keys: K[]): Record<K, string> {
  const fields = parseModelObject(text);
  for (const key of keys) if (!(key in fields)) throw new AIError('invalid_code', `JSON thiếu trường ${key}.`, 422);
  if (Object.keys(fields).length !== keys.length) {
    throw new AIError('invalid_code', `JSON phải có đúng các trường ${keys.join(', ')}, không thêm field khác.`, 422);
  }
  return Object.fromEntries(keys.map((key) => [key, readPart(fields, key, key === 'helpers')])) as Record<K, string>;
}

// Only deterministic entrypoint syntax is supplied locally; ALL gameplay stays
// model-generated. The assembled source still passes the unchanged validator.
function finish(text: string): string {
  // Keep compatibility with providers returning the canonical source envelope.
  if (readSource(text)) return text;
  const fields = parseModelObject(text);
  if ('source' in fields) {
    if (typeof fields.source !== 'string') throw new AIError('invalid_code', 'Trường source phải là chuỗi.', 422);
    if (fields.source.trim() === '') throw new AIError('invalid_code', 'Trường source đang rỗng.', 422);
    if (Buffer.byteLength(fields.source, 'utf8') > CODE_MAX_BYTES) throw new AIError('invalid_code', 'Trường source vượt quá 24 KB.', 422);
    throw new AIError('invalid_code', 'JSON có source nhưng không đúng schema {source: string}.', 422);
  }
  const parts = parseParts(text, ['setup', 'update', 'helpers']);
  const output = JSON.stringify({ source: `function create(api: GameAPI): void {\n${parts.setup}\n}\nfunction update(api: GameAPI, dt: number): void {\n${parts.update}\n}\n${parts.helpers}` });
  if (!readSource(output)) throw new AIError('invalid_code', 'Code ghép vượt giới hạn 24 KB.', 422);
  return output;
}

export function readSource(text: string): string | undefined {
  if (Buffer.byteLength(text, 'utf8') > CODE_MAX_BYTES * 2) return undefined;
  try {
    const result = CodeSourceSchema.safeParse(JSON.parse(text));
    return result.success && Buffer.byteLength(result.data.source, 'utf8') <= CODE_MAX_BYTES ? result.data.source : undefined;
  } catch { return undefined; }
}
