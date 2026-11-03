import { CODE_MAX_BYTES, CodeSourceSchema, GAME_CODE_API, GamePlanSchema, type AgentRequest, type GamePlan } from '@game-creator/contracts';
import { GameGenerationService } from '../services/game-generation-service.js';
import { AIError, RequestCapacityError } from '../providers/errors.js';
import { estimateInputTokens } from '../providers/groq-rate-limit.js';
import type { ProviderTelemetry } from '../providers/ai-provider.js';
import ts from 'typescript';

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
const RULES = `Implement the requested playable game as TypeScript function BODIES in JSON: setup, update, helpers. The host supplies typed create(api: GameAPI): void and update(api: GameAPI, dt: number): void wrappers; do not repeat them. helpers may be empty. Use single-quoted code strings, normal JSON escaping, no markdown/comments. Keep code concise but implement ALL requested mechanics/counts.
Strict TS: guard api.get/array reads. Use (api.state.key ?? 0) on EVERY numeric state read. Example: api.state.cooldown = (api.state.cooldown ?? 0) - dt; if ((api.state.cooldown ?? 0) <= 0) { ... }. Avoid ++/+=/-= on state. Initialize state in setup; literal keys only (never state[dynamicKey]).
Use state ONLY for changing counters/entity IDs (prefer <=8 keys); use literal constants for speed, size, color. Correct read: const p = api.get(api.state.playerId ?? 0); if (!p) { return; }. Correct score update: api.state.score = (api.state.score ?? 0) + 10. Every referenced state key must be initialized. Check collisions before continue; ignore self-collision. Boss must be reachable and destroyable.
Scoring MUST call api.addScore(points); state.score alone is invisible. api.spawn defaults hp=1; set the player's hp explicitly when more lives are intended. Setup locals are NOT visible in update. Do not redeclare the api/dt parameters.
SHOOTING is not placing a mine: spawn each shot just outside the player's front edge, set its firing velocity, then move EVERY live shot EACH update, even after action release: e.x += e.vx * dt; e.y += e.vy * dt. The engine NEVER integrates vx/vy. Do not put shot movement inside the input/cooldown branch or skip it with continue. Use requested direction (or pointer aim), cooldown, collision damage to target.hp, removal of defeated targets and shots outside any screen edge. Keep mines/traps stationary only when requested. Gameplay tests check launch offset, independent flight, hit damage and offscreen cleanup.
No imports, globals, DOM, network, storage, timers, async, new, classes, any/casts, reflection, try/catch, destructuring, spread or dynamic strings. Loops need braces. Arrays: for-of, numeric index, length/push/pop/splice only. Math: random/floor/ceil/round/abs/min/max/sqrt/sin/cos/atan2/hypot/PI only.
960x540, entity x/y are CENTER coordinates, HUD y<60. Engine draws entities and provides score/R restart. YOU update positions with dt, collisions, input, score, reachable win/loss. setPlayer; cooldowns; remove offscreen/dead entities; <=160 objects, <=5000 checks/frame. No instant win/loss in first 3s. Preserve shooting/boss if requested. No assets. State stores NUMBERS only. Use for-of over api.entities; fixed strings in status, host displays score.
${GAME_CODE_API.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim()}`;

type Observer = (event: ProviderTelemetry) => void;
// Original request remains authoritative; omit duplicated display title/summary.
const brief = (request: AgentRequest, plan: GamePlan) => ({ request: request.prompt, mechanics: plan.mechanics, movement: plan.movement, action: plan.action, objective: plan.objective });
const observer = (onTelemetry?: Observer) => onTelemetry ? { onTelemetry } : {};

export class GamePlanner {
  constructor(private readonly generation: GameGenerationService) {}
  async plan(request: AgentRequest, client: string, signal: AbortSignal, onTelemetry?: Observer): Promise<GamePlan> {
    const text = await this.generation.generateArtifact(request, { prompt: request.prompt, maxOutputTokens: 450, jsonSchema: planSchema, ...observer(onTelemetry),
      systemPrompt: 'Plan a small 960x540 game. JSON only, concise text in user language: title <=40 chars, summary one short sentence, 2-5 short mechanics, objective <=100 chars. Preserve ALL requested counts/features including boss/bullets. Colored shapes, <=160 objects, no external assets. Include reachable win/loss. movement/action describe real keyboard/Space/pointer input; at least one not none.' }, client, signal);
    try {
      if (Buffer.byteLength(text) > 8192) throw new Error();
      const plan = GamePlanSchema.parse(JSON.parse(text));
      if (plan.movement === 'none' && plan.action === 'none') throw new Error();
      return plan;
    } catch { throw new AIError('invalid_code', 'Provider không trả kế hoạch game tương tác hợp lệ. Hãy rút gọn yêu cầu hoặc chọn model khác trong Settings.', 422); }
  }
}

export class CodeGenerator {
  constructor(protected readonly generation: GameGenerationService) {}
  protected input(prompt: Record<string, unknown>, maxOutputTokens: number, onTelemetry?: Observer) {
    const context = Object.entries(prompt).map(([key, value]) => `${key.toUpperCase()}:\n${Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : JSON.stringify(value)}`).join('\n\n');
    return { prompt: context, systemPrompt: RULES, jsonSchema: partSchema(['setup', 'update', 'helpers']), maxOutputTokens, ...observer(onTelemetry) };
  }
  async generate(request: AgentRequest, plan: GamePlan, client: string, signal: AbortSignal, onTelemetry?: Observer): Promise<string> {
    try { return program(await this.generation.generateArtifact(request, this.input({ ...brief(request, plan), task: 'Implement complete game logic in setup/update bodies; api and dt are already typed parameters.' }, 2400, onTelemetry), client, signal)); }
    catch (error) {
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
    return program(JSON.stringify({ setup, ...rest }));
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
    const input = this.input({ ...brief(request, plan), source, diagnostics: errors, task: 'Fix ALL errors in SOURCE. Return corrected setup/update bodies and helpers. Setup and update are SEPARATE functions: local constants in setup are NOT visible in update. Preserve every requested mechanic.' }, 2400, onTelemetry);
    try { return program(await this.generation.generateArtifact(request, input, client, signal)); }
    catch (error) {
      if (!(error instanceof RequestCapacityError)) throw error;
      // Oversized broken source is not repeatedly resent or silently truncated.
      // Rebuild from the original requirements in two cooperating code parts.
      return this.split(request, plan, client, signal, error.tokenLimit, errors, onTelemetry);
    }
  }
}

function parseParts<K extends keyof typeof partProperties>(text: string, keys: K[]): Record<K, string> {
  try {
    if (Buffer.byteLength(text) > CODE_MAX_BYTES * 2) throw new Error();
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const fields = value as Record<string, unknown>;
    if (Object.keys(fields).length !== keys.length || keys.some((key) => typeof fields[key] !== 'string'
      || (key !== 'helpers' && !fields[key]) || (fields[key] as string).length > CODE_MAX_BYTES)) throw new Error();
    return fields as Record<K, string>;
  } catch { throw new AIError('invalid_code', 'Provider không trả code đầy đủ trong giới hạn cho phép.', 422); }
}

// Only deterministic entrypoint syntax is supplied locally; ALL gameplay stays
// model-generated. The assembled source still passes the unchanged validator.
function program(text: string): string {
  // Keep compatibility with providers returning the canonical source envelope.
  if (readSource(text)) return text;
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
