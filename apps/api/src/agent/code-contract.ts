import { CODE_MAX_BYTES } from '@game-creator/contracts';
import { AIError } from '../providers/errors.js';

// Single description of the runtime the model may use. The compiler lib is
// GAME_CODE_API; this text must not add methods, fields or globals.
export const CODE_CONTRACT = `Return JSON with exactly the keys setup, update, helpers. Values are strings. No markdown, no extra keys.
setup and update are statement bodies only. The host writes:
function create(api: GameAPI): void { /* setup */ }
function update(api: GameAPI, dt: number): void { /* update */ }
helpers is "" or extra functions. Never emit function create or function update. Never declare api, dt, w or h.
interface Entity { readonly id: number; kind: string; x: number; y: number; width: number; height: number; color: number; vx: number; vy: number; hp: number; alive: boolean }
interface GameAPI {
  readonly width: number; readonly height: number; readonly time: number;
  readonly input: { readonly left: boolean; readonly right: boolean; readonly up: boolean; readonly down: boolean; readonly action: boolean; readonly pointerDown: boolean; readonly pointerX: number; readonly pointerY: number };
  readonly state: { [key: string]: number };
  readonly entities: Entity[];
  spawn(kind: string, x: number, y: number, width: number, height: number, color: number): Entity;
  remove(entity: Entity): void; get(id: number): Entity | undefined; setPlayer(entity: Entity): void;
  overlaps(a: Entity, b: Entity): boolean; addScore(points: number): void; status(text: string): void; win(): void; lose(): void;
}
World is api.width by api.height (960x540). x/y are centers. HUD is y<60. dt is seconds, already a parameter of update, capped at 0.05. There is no global w or h.
state stores NUMBERS only (ids, counters, timers). Never assign true, false, undefined or null; a flag is 1 or 0. Every read is number | undefined. Never use +=, -= or ++ on api.state. Parenthesize ??: (api.state.pipeInterval ?? 0). A counter or timer is:
const timer = api.state.pipeTimer ?? 0;
api.state.pipeTimer = timer + dt;
An entity id is not a timer. Do not use ?? 0 for an id.
After setPlayer(player), save that id before update: api.state.playerId = player.id. Use the same key update reads.
const playerId = api.state.playerId;
if (playerId === undefined) { return; }
const player = api.get(playerId);
if (player === undefined) { return; }
player.vy = -300;
Call overlaps, remove and setPlayer only with that checked player. Entity fields are only id, kind, x, y, width, height, color, vx, vy, hp, alive. Do not write e.scored or any other field. Score one pipe of a pair once. Ids increase as pipes spawn, so remember the highest scored id: const scored = api.state.lastScored; if (e.kind === "upperPipe" && e.x < player.x && (scored === undefined || e.id > scored)) { api.state.lastScored = e.id; api.addScore(1); }
A const declared in setup does not exist in update. Repeat that numeric const in update, or save api.state.gap = 120 in setup and read it back with const gap = api.state.gap ?? 0. Do not read setup locals from update. Do not declare a function in setup. helpers: function spawnPipe(api: GameAPI): void, called as spawnPipe(api). Spawn the first pipe pair in setup, or start its timer at the interval, and move every pipe on every frame.
spawn returns an Entity. Store player.id. Never write api.state.bird = api.spawn(...) or api.state.bird.vy.
Every spawn width and height is a number from 1 to 200 inclusive. Never pass api.height as a size. Math.floor(Math.random() * 200) + 50 can exceed 200. A taller pipe is several entities of height 200 stacked on the same x so the edges touch; the last piece uses the remainder.
Never assign [] to state. Never call push, pop, splice or indexOf on a state field.
kind is the spawn string; use "upperPipe" and "lowerPipe", not a kind spawn never used. Entity[] has no forEach. for (const e of api.entities) { if (e.kind === "upperPipe" || e.kind === "lowerPipe") { e.x -= 140 * dt; } }
api.get returns Entity | undefined. Check the id, then the entity. Never use {} as an entity.
spawn sets hp=1 and vx=vy=0. The engine does NOT move entities; every frame add vx*dt and vy*dt yourself, including after the action key is released. addScore is the only visible score. setPlayer once. Initialize every state key in setup. Literal keys only: api.state.score, never state[name] or entity[name].
Patterns, not presets: gravity e.vy += 900 * dt; flap is if (api.input.action || api.input.pointerDown) { e.vy = -300; } horizontal/vertical input changes x/y; a shot is a new entity spawned just outside the shooter with its own vx/vy, moved on every frame; bounce flips vx or vy; overlap then addScore/hp/remove/win/lose. No win or lose in the first 3 seconds.
Allowed array methods: length, push, pop, splice, numeric index, for-of. No indexOf. Loops need braces. Do not reference a variable in its own initializer. No imports, DOM, network, storage, timers, async, new, classes, any, casts, try/catch, destructuring, spread, dynamic strings or string concatenation.
Reserved names, even for locals: top, parent, self, window, document, globalThis, frames, location, open, fetch, eval, Function. Name an upper pipe upperPipe, not top.`;

export const PLAN_LIMITS = 'API limits for the plan: state holds only numbers, never undefined or Entity; groups are entities with a kind string; each entity is at most 200 by 200 and a long pipe is several stacked entities; screen size is api.width/api.height; update receives dt. movement is only the player steering keys. Gravity, flap, and pipes or enemies that move by themselves are not vertical or horizontal. If the user did not name arrow keys, WASD, or left/right/up/down keys, movement is none. If both Space and click are requested, set action to space and mention pointer in mechanics (input.action and input.pointerDown both exist). Do not plan array state, custom entity fields, globals w/h, or mechanics the API cannot express.';

const HINTS: Array<[RegExp, string]> = [
  [/Duplicate identifier 'dt'/, "dt already exists as the update parameter. Delete any const, let or nested parameter named dt. Do not wrap the body in function update."],
  [/Cannot find name 'w'|Cannot find name 'h'/, 'There is no global w or h. Use api.width and api.height.'],
  [/Property '(push|pop|splice|indexOf)' does not exist on type 'number'|Type 'never\[\]'/, 'api.state values are numbers only. Do not assign [] and do not call push, pop, splice or indexOf on a state field. Track groups with for (const e of api.entities) and e.kind.'],
  [/indexOf/, 'The allowed array type has length, push, pop, splice and numeric index. It has no indexOf. Scan api.entities by kind instead.'],
  [/Property '(x|y|vx|vy|hp|width|height|alive|kind|id|color)' does not exist on type 'number'/, 'This is a number id, not an Entity and not an array. Store spawn(...).id. const playerId = api.state.player; if (playerId !== undefined) { const player = api.get(playerId); if (player) { player.y += player.vy * dt; } }'],
  [/Type 'Entity' is not assignable to type 'number'|Type 'Entity \| undefined' is not assignable to type 'number'/, 'api.state stores a number id, not an Entity. const bird = api.spawn(...); api.state.player = bird.id. Do not write api.state.bird = bird or api.state.bird.vy.'],
  [/Entity \| \{\}|Argument of type '\{\}'/, 'Never substitute {}. api.get returns Entity | undefined; if (!entity) { return; }'],
  [/used before its declaration|implicitly has type 'any'/, 'Do not reference a variable in its own initializer. Compute the number from state and api.width/api.height first, then use it.'],
  [/index động|Element implicitly has an 'any'/, 'No dynamic property access. Use literal names: api.state.score, e.kind, e.x, e.y, e.vx, e.vy, e.hp.'],
];

export function repairHints(diagnostics: readonly string[]): string[] {
  const text = diagnostics.join('\n');
  const hints = HINTS.filter(([pattern]) => pattern.test(text)).map(([, hint]) => hint);
  const missing = [...new Set([...text.matchAll(/Cannot find name '(\w+)'/g)].map((match) => match[1]).filter((name): name is string => Boolean(name)))];
  if (missing.length) hints.unshift(`These names are not in this function: ${missing.join(', ')}. A const in setup is invisible in update and in a file-level helper. Inside the helper read const ${missing[0]} = api.state.${missing[0]} ?? 0 after setup assigns that number. If the missing name is a function, move it into helpers as function name(api: GameAPI): void. Do not assign undefined.`);
  if (/(?<![=!])=\s*(?:undefined|null)\b/.test(text) || /boolean' is not assignable to type 'number'/.test(text)) hints.unshift('Do not assign undefined or null to api.state. Use 1 and 0, never true or false. Delete that assignment.');
  if (/Entity \| undefined|Argument of type 'Entity \| undefined'/.test(text) || diagnostics.some((line) => undefinedUse(line) === 'entity')) {
    hints.unshift('api.get returns Entity | undefined. const playerId = api.state.playerId; if (playerId === undefined) { return; } const player = api.get(playerId); if (player === undefined) { return; } Only then pass player to overlaps, remove or setPlayer. Also store api.state.playerId = player.id in setup or update returns immediately.');
  }
  if (diagnostics.some((line) => undefinedUse(line) === 'number')) {
    hints.unshift('A local copied from api.state is number | undefined. In arithmetic write const gap = api.state.gap ?? 0. Do not treat that number as an Entity and do not use ?? 0 for an id passed to api.get.');
  }
  if (/không đi lên|không làm nhân vật đi lên|không chịu trọng lực|không đổi vị trí nhân vật/.test(text)) {
    hints.unshift('Flap on Space and click: if (api.input.action || api.input.pointerDown) { player.vy = -300; } Keep gravity player.vy += 900 * dt. After setPlayer(player), store api.state.playerId = player.id with the same key update reads. Do not move this player with arrow keys.');
  }
  if (/di chuyển liên tục|Va chạm được yêu cầu/.test(text)) {
    hints.unshift('Spawn the first pipe pair immediately and move it every frame. Width and height are 1..200; stack a taller pipe so the edges touch. Overlap with the player calls lose.');
  }
  const extraField = text.match(/Property '(\w+)' does not exist on type 'Entity'/);
  if (extraField) hints.unshift(`Entity has no property ${extraField[1]}. Fields are only id, kind, x, y, width, height, color, vx, vy, hp, alive. Do not store a flag on the entity. Score one pipe once: const scored = api.state.lastScored; if (e.kind === "upperPipe" && e.x < player.x && (scored === undefined || e.id > scored)) { api.state.lastScored = e.id; api.addScore(1); }`);
  if (/1 đến 200|Kích thước vật thể/.test(text)) hints.unshift('Every spawn width and height must be from 1 to 200. Math.min(200, height) is still illegal when height is below 1. Stack segments of height 200 on the same x so their edges touch, and make the last segment the remainder. Do not spawn one pipe with height api.height.');
  if (/forEach' does not exist/.test(text)) hints.unshift('Entity[] has no forEach. Write for (const e of api.entities) { ... } with braces. Do not use return inside that loop to mean continue.');
  if (/left operand is never nullish/.test(text)) hints.unshift('Delete the extra ?? . Keep one parenthesized fallback: if (timer >= (api.state.pipeInterval ?? 0)).');
  if (/have no overlap/.test(text)) hints.unshift('e.kind is the exact string passed to spawn. Do not compare one entity with two different kind literals. Spawn the top pipe as "upperPipe" and the bottom as "lowerPipe", move both, and score only upperPipe once.');
  if (/implicitly has an 'any' type/.test(text)) hints.unshift('Type every helper parameter. Write function spawnPipe(api: GameAPI): void. Do not write function spawnPipe(api).');
  if (/repair_no_progress/.test(text)) hints.unshift('repair_no_progress: the previous repair left the same errors. Change the listed lines. Do not return the same source.');
  const reserved = [...new Set([...text.matchAll(/Không được truy cập (\w+)/g)].map((match) => match[1]).filter((name): name is string => Boolean(name)))];
  if (reserved.length) hints.unshift(`These names are reserved: ${reserved.join(', ')}. Rename locals (upperPipe instead of top). Do not read those host objects.`);
  const undefinedHint = undefinedStateHint(diagnostics);
  if (undefinedHint) hints.unshift(undefinedHint);
  return hints;
}

function undefinedUse(line: string): 'entity' | 'number' | undefined {
  if (/Entity \| undefined/.test(line)) return 'entity';
  const name = line.match(/'([A-Za-z_]\w*)' is possibly 'undefined'/)?.[1];
  if (!name) return undefined;
  if (new RegExp(`[-+*/]\\s*${name}\\b|\\b${name}\\s*[-+*/]`).test(line)) return 'number';
  return 'entity';
}

function undefinedStateHint(diagnostics: readonly string[]): string | undefined {
  const relevant = diagnostics.filter((line) => !/(?<![=!])=\s*(?:undefined|null)\b/.test(line) && undefinedUse(line) !== 'entity');
  const expressions = [...new Set(relevant.flatMap((line) => {
    if (!/number \| undefined|possibly 'undefined'|Operator '(?:<=|>=|<|>)' cannot be applied/.test(line)) return [];
    return [...line.matchAll(/`([^`]*)`|api\.state\.\w+/g)].map((match) => (match[1] ?? match[0]).trim()).filter((item) => item.length > 0);
  }))].slice(0, 6);
  if (!/number \| undefined|possibly 'undefined'|Operator '(?:<=|>=|<|>)' cannot be applied/.test(relevant.join('\n'))) return undefined;
  const focus = expressions.length ? `Failing expression: ${expressions.join('; ')}. ` : '';
  return `${focus}This value is number | undefined, not an array. Edit only that expression. Counter or timer: const timer = api.state.pipeTimer ?? 0; api.state.pipeTimer = timer + dt. Entity id, do not use ?? 0: const playerId = api.state.player; if (playerId !== undefined) { const player = api.get(playerId); if (player) { player.vy += 900 * dt; } }`;
}

export function parseModelObject(text: string): Record<string, unknown> {
  if (Buffer.byteLength(text, 'utf8') > CODE_MAX_BYTES * 2) {
    throw new AIError('invalid_code', 'JSON của provider vượt quá giới hạn kích thước. Đây không phải lỗi TypeScript hay hết quota.', 422);
  }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new AIError('invalid_code', 'Provider trả về chuỗi không phải JSON hợp lệ. Đây không phải lỗi TypeScript hay hết quota.', 422); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AIError('invalid_code', 'JSON của provider phải là một object, không phải mảng, null hay kiểu khác.', 422);
  }
  return value as Record<string, unknown>;
}

export function readPart(fields: Record<string, unknown>, key: string, optional: boolean): string {
  if (!(key in fields)) throw new AIError('invalid_code', `JSON thiếu trường ${key}.`, 422);
  const value = fields[key];
  if (typeof value !== 'string') throw new AIError('invalid_code', `Trường ${key} phải là chuỗi.`, 422);
  if (!optional && value.trim() === '') throw new AIError('invalid_code', `Trường ${key} đang rỗng.`, 422);
  if (Buffer.byteLength(value, 'utf8') > CODE_MAX_BYTES) throw new AIError('invalid_code', `Trường ${key} vượt quá 24 KB.`, 422);
  return value;
}
