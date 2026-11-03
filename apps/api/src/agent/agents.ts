import { CODE_MAX_BYTES, CodeSourceSchema, GAME_CODE_API, GamePlanSchema, type AgentRequest, type GamePlan } from '@game-creator/contracts';
import { GameGenerationService } from '../services/game-generation-service.js';
import { AIError } from '../providers/errors.js';

const planSchema = { type: 'object', additionalProperties: false, required: ['title', 'summary', 'mechanics', 'movement', 'action', 'objective'], properties: {
  title: { type: 'string' }, summary: { type: 'string' }, mechanics: { type: 'array', items: { type: 'string' } },
  movement: { type: 'string', enum: ['horizontal', 'vertical', 'free', 'none'] }, action: { type: 'string', enum: ['space', 'pointer', 'none'] }, objective: { type: 'string' },
} };
const sourceSchema = { type: 'object', additionalProperties: false, required: ['source'], properties: { source: { type: 'string' } } };
const RULES = `Write a NEW playable Phaser 3 game, implementing the requested mechanics in TypeScript, not GameSpec/template configuration.
Output JSON {"source":"..."}, a single game.ts <=24KB, preferably <9000 characters. No markdown.
Only top-level function declarations; required create(api: GameAPI): void and update(api: GameAPI, dt: number): void. Helpers allowed.
No imports/exports, classes, new, any, type casts, globals, DOM, network, storage, timers, promises, async, try/catch, reflection, constructors or prototype access.
No destructuring, spread, dynamic string concatenation or template interpolation. All loops need braces. Array API: length, push, pop, splice and numeric indexing ONLY; no map/filter/find/forEach. Check undefined array elements and api.get results.
Only Math.random/floor/ceil/round/abs/min/max/sqrt/sin/cos/atan2/hypot/PI are available. No other JavaScript builtins.
All persistent state: numeric api.state.name entries, initialized in create; read/write only literal keys, no dynamic property access. Local arrays/objects allowed; no globals or closures stored in state.
Entity vx/vy are YOUR data: update x/y explicitly using dt. SetPlayer for controlled entity. Remove bullets/enemies offscreen; max160 live entities, max5000 loop/function checks per frame. Don't spawn per frame without cooldowns. Keep individual frame work small.
Use api.overlaps for collision, addScore, win/lose. Render colored shapes via spawn; no external assets. R/restart button and HUD/score are provided by engine. status uses short fixed strings only.
Implement meaningful player input, enemies/interaction, scoring and reachable win/loss. Preserve requested mechanics (e.g. shooting and boss); do not replace them with a different game. Avoid instant wins/losses during first 3 seconds for testing.
${GAME_CODE_API}`;

export class GamePlanner {
  constructor(private readonly generation: GameGenerationService) {}
  async plan(request: AgentRequest, client: string, signal: AbortSignal): Promise<GamePlan> {
    const text = await this.generation.generateArtifact(request, { prompt: request.prompt, maxOutputTokens: 900, jsonSchema: planSchema,
      systemPrompt: 'Plan a small original 2D Phaser game from the user request. JSON only. Describe specific mechanics and a reachable win/loss goal; preserve requested counts and features. Keyboard arrows/WASD and Space, or pointer. Simple colored shapes; no paid assets. 960x540; max160 objects. MVP must be playable, not just animation. Include boss/bullets if requested. No external code/services. Text in user language. The movement/action fields tell a browser tester which input to exercise. At least one must not be none.' }, client, signal);
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
  generate(request: AgentRequest, plan: GamePlan, client: string, signal: AbortSignal) {
    return this.generation.generateArtifact(request, { prompt: JSON.stringify({ request: request.prompt, plan }), systemPrompt: RULES,
      jsonSchema: sourceSchema, maxOutputTokens: 4096 }, client, signal);
  }
}

export class CodeRepairAgent extends CodeGenerator {
  repair(request: AgentRequest, plan: GamePlan, source: string, diagnostics: string[], client: string, signal: AbortSignal) {
    return this.generation.generateArtifact(request, { prompt: JSON.stringify({ request: request.prompt, plan, source: source.slice(0, CODE_MAX_BYTES), diagnostics: diagnostics.slice(0, 10), task: 'Fix the errors while preserving ALL requested mechanics. Return the complete replacement source.' }),
      systemPrompt: RULES, jsonSchema: sourceSchema, maxOutputTokens: 4096 }, client, signal);
  }
}

export function readSource(text: string): string | undefined {
  if (Buffer.byteLength(text, 'utf8') > CODE_MAX_BYTES * 2) return undefined;
  try {
    const result = CodeSourceSchema.safeParse(JSON.parse(text));
    return result.success && Buffer.byteLength(result.data.source, 'utf8') <= CODE_MAX_BYTES ? result.data.source : undefined;
  } catch { return undefined; }
}
