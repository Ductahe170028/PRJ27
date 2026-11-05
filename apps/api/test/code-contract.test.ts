import vm from 'node:vm';
import { expect, it } from 'vitest';
import { CodeGenerator, CodeRepairAgent, GamePlanner, readSource } from '../src/agent/agents.js';
import { CodeValidator } from '../src/agent/code-validator.js';
import { repairHints } from '../src/agent/code-contract.js';
import { GameGenerationService } from '../src/services/game-generation-service.js';
import { StructuredOutputError } from '../src/providers/errors.js';
import type { AIRequest } from '../src/providers/ai-provider.js';
import { mockProvider, mockRegistry } from './fixtures.js';
import { flapSource, paddleSource, platformerSource, shooterPlan, shooterSource, topDownSource } from './agent-fixtures.js';

const request = { providerId: 'groq', prompt: 'Tạo game có di chuyển, va chạm và điểm' };
const signal = new AbortController().signal;
function service(outputs: Array<string | Error>) {
  const generate = async () => { const next = outputs.shift(); if (next instanceof Error) throw next; return next ?? ''; };
  return new GameGenerationService(mockRegistry([mockProvider('groq', generate as (input: AIRequest) => Promise<string>)]));
}
const body = (source: string) => source.slice(source.indexOf('{') + 1, source.lastIndexOf('}'));
const [create, update] = shooterSource.split('function update');
const parts = { setup: body(create!), update: body(update!), helpers: '' };

it('keeps newlines, quotes and backticks exactly when assembling model JSON', async () => {
  const setup = 'api.status("a\\"b");\nconst mark = "back`tick";';
  const output = await new CodeGenerator(service([JSON.stringify({ setup, update: 'const p = api.get(1);', helpers: '' })])).generate(request, shooterPlan, 'test', signal);
  const source = readSource(output)!;
  expect(source).toContain(setup);
  expect(source).toContain('function update(api: GameAPI, dt: number)');
  expect(source.split(setup)).toHaveLength(2);
});

it.each([
  ['not json', 'không phải JSON'],
  [JSON.stringify({ setup: 'api.status("ok");' }), 'thiếu trường update'],
  [JSON.stringify({ setup: 'api.status("ok");', update: '   ', helpers: '' }), 'update đang rỗng'],
  [JSON.stringify({ source: '' }), 'source đang rỗng'],
  [JSON.stringify({ source: 12 }), 'source phải là chuỗi'],
  [JSON.stringify({ setup: 'let ready = 1;', update: 'ready = 2;', helpers: '', extra: true }), 'không thêm field'],
])('reports JSON problem %j without calling it a TypeScript or quota error', async (payload, message) => {
  await expect(new CodeGenerator(service([payload])).generate(request, shooterPlan, 'test', signal)).rejects.toMatchObject({ code: 'invalid_code', message: expect.stringContaining(message) });
});

it('recovers a schema rejection when the provider still returned parseable parts', async () => {
  const error = new StructuredOutputError('schema', JSON.stringify(parts));
  const source = readSource(await new CodeGenerator(service([error])).generate(request, shooterPlan, 'test', signal))!;
  expect(new CodeValidator().validate(source).errors).toEqual([]);
});

it('does not replace a schema rejection with a generic parse error when recovery fails', async () => {
  const error = new StructuredOutputError('Groq trả JSON không khớp schema structured output (json_validate_failed).', 'not-json');
  await expect(new CodeGenerator(service([error])).generate(request, shooterPlan, 'test', signal)).rejects.toBe(error);
});

it('gives planning, coding and repair the same API limits', async () => {
  const outputs = [JSON.stringify(shooterPlan), JSON.stringify(parts)];
  const generate = async (input: AIRequest) => { const next = outputs.shift(); expect(input.systemPrompt).toContain('state holds only numbers'); return next ?? ''; };
  const generation = new GameGenerationService(mockRegistry([mockProvider('groq', generate)]));
  await new GamePlanner(generation).plan(request, 'test', signal);
  const coding = new GameGenerationService(mockRegistry([mockProvider('groq', async (input) => {
    expect(input.systemPrompt).toContain('state stores NUMBERS only');
    expect(input.systemPrompt).toContain('const timer = api.state.pipeTimer ?? 0');
    expect(input.systemPrompt).toContain('playerId === undefined');
    expect(input.systemPrompt).toContain('1 to 200');
    expect(input.systemPrompt).toContain('e.scored');
    expect(input.systemPrompt).toContain('api.width');
    expect(input.maxOutputTokens).toBe(2400);
    return JSON.stringify(parts);
  })]));
  await new CodeGenerator(coding).generate(request, shooterPlan, 'test', signal);
  const diagnostics = ["game.ts:4: Duplicate identifier 'dt'.", "game.ts:5: Cannot find name 'w'.", "game.ts:6: Property 'push' does not exist on type 'number'."];
  const repair = new GameGenerationService(mockRegistry([mockProvider('groq', async (input) => {
    expect(input.systemPrompt).toContain('state stores NUMBERS only');
    expect(input.prompt).toContain(shooterSource);
    expect(input.prompt.split(shooterSource)).toHaveLength(2);
    expect(input.prompt).toContain('api.width');
    expect(input.prompt).toContain('numbers only');
    expect(input.prompt).toContain("Duplicate identifier 'dt'");
    expect(input.maxOutputTokens).toBe(2400);
    return JSON.stringify(parts);
  })]));
  await new CodeRepairAgent(repair).repair(request, shooterPlan, shooterSource, diagnostics, 'test', signal);
  expect(repairHints(diagnostics).join('\n')).toContain('api.entities');
  const live = repairHints([
    "game.ts:5: Không được truy cập top.",
    "game.ts:5: Argument of type 'number | undefined' is not assignable to parameter of type 'number'.",
  ]);
  expect(live.join('\n')).toContain('upperPipe');
  expect(live.join('\n')).toContain('const timer = api.state.pipeTimer ?? 0');
  expect(live.join('\n')).toContain('playerId !== undefined');
  expect(live.join('\n')).not.toContain('api.get(api.state.player ?? 0)');
  expect(live.join('\n')).not.toContain('Do not assign []');
  const expressed = repairHints(["game.ts:5: `api.state.pipeWidth` Argument of type 'number | undefined' is not assignable to parameter of type 'number'."]);
  expect(expressed.join('\n')).toContain('api.state.pipeWidth');
  expect(expressed.join('\n')).not.toContain('Do not assign []');
  expect(repairHints(["game.ts:5: Property 'vy' does not exist on type 'number'."]).join('\n')).toContain('not an Entity');
  expect(repairHints(["game.ts:5: Property 'vy' does not exist on type 'number'."]).join('\n')).not.toContain('Do not assign []');
  const assigned = repairHints(["game.ts:9: `api.state.playerId = undefined` Type 'undefined' is not assignable to type 'number'."]);
  expect(assigned.join('\n')).toContain('Do not assign undefined');
  expect(assigned.join('\n')).not.toContain('?? 0');
  expect(repairHints(["game.ts:61: `api.overlaps(e, player)` Argument of type 'Entity | undefined' is not assignable to parameter of type 'Entity'."]).join('\n')).toContain('if (player === undefined) { return; }');
  expect(repairHints(["game.ts:65: 'player' is possibly 'undefined'."]).join('\n')).toContain('api.get returns Entity | undefined');
  expect(repairHints(["game.ts:66: Property 'scored' does not exist on type 'Entity'."]).join('\n')).toContain('api.state.lastScored');
  expect(repairHints(['Kích thước vật thể phải từ 1 đến 200.']).join('\n')).toContain('height 200');
  expect(repairHints(["game.ts:35: Cannot find name 'pipeGap'."]).join('\n')).toContain('invisible in update');
  const gap = repairHints(["game.ts:33: `const yGap = Math.random() * (api.height - gap - 40) + 20` 'gap' is possibly 'undefined'."]);
  expect(gap.join('\n')).toContain('const gap = api.state.gap ?? 0');
  expect(gap.join('\n')).not.toContain('api.get returns Entity | undefined');
  expect(repairHints(['Space không làm nhân vật đi lên khi trò chơi còn đang chơi.']).join('\n')).toContain('api.state.playerId = player.id');
});

interface Entity { id: number; kind: string; x: number; y: number; width: number; height: number; color: number; vx: number; vy: number; hp: number; alive: boolean }
function play(source: string) {
  const compiled = new CodeValidator().validate(source);
  expect(compiled.errors, compiled.errors.join('\n')).toEqual([]);
  const context = { __budget() {}, create: (_api: object) => {}, update: (_api: object, _dt: number) => {} };
  vm.createContext(context);
  vm.runInContext(compiled.javascript ?? '', context);
  let next = 1, score = 0, ended = '';
  const entities = new Map<number, Entity>();
  const state: Record<string, number> = Object.create(null);
  const input = { left: false, right: false, up: false, down: false, action: false, pointerDown: false, pointerX: 0, pointerY: 0 };
  const api = {
    width: 960, height: 540, time: 0, input, state,
    get entities() { return [...entities.values()]; },
    spawn(kind: string, x: number, y: number, width: number, height: number, color: number) {
      const entity: Entity = { id: next++, kind, x, y, width, height, color, vx: 0, vy: 0, hp: 1, alive: true };
      entities.set(entity.id, entity); return entity;
    },
    remove(entity: Entity) { entity.alive = false; entities.delete(entity.id); },
    get: (id: number) => entities.get(id),
    setPlayer() {}, overlaps(a: Entity, b: Entity) { return a.alive && b.alive && Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2; },
    addScore(points: number) { score += points; }, status() {}, win() { ended = 'win'; }, lose() { ended = 'lose'; },
  };
  context.create(api);
  const step = (frames: number) => { for (let i = 0; i < frames; i += 1) { api.time += 1 / 60; context.update(api, 1 / 60); } };
  return { api, entities, step, score: () => score, ended: () => ended, of: (kind: string) => [...entities.values()].filter((entity) => entity.kind === kind) };
}

it('runs platformer gravity, jump, landing and collection on the shared API', () => {
  const game = play(platformerSource);
  const player = () => game.of('player')[0]!;
  const start = player().y;
  game.step(15);
  expect(player().y).toBeGreaterThan(start + 20);
  game.step(50);
  expect(game.api.state.grounded).toBe(1);
  const landed = player().y;
  game.api.input.action = true; game.step(8);
  expect(player().y).toBeLessThan(landed - 10);
  game.api.input.action = false; game.api.input.right = true; game.step(70);
  expect(game.score()).toBe(1);
  expect(game.of('coin')).toHaveLength(0);
});

it('runs top-down movement and collection without gravity', () => {
  const game = play(topDownSource);
  const player = () => game.of('player')[0]!;
  const y = player().y;
  game.api.input.right = true; game.step(60);
  expect(player().x).toBeGreaterThan(250);
  expect(player().y).toBeCloseTo(y, 0);
  expect(game.score()).toBe(1);
  game.step(90);
  expect(game.ended()).toBe('lose');
});

it('runs a shot after the action is released', () => {
  const game = play(shooterSource);
  game.step(5);
  expect(game.of('bullet')).toHaveLength(0);
  game.api.input.action = true; game.step(1); game.api.input.action = false;
  const y = game.of('bullet')[0]!.y;
  game.step(12);
  expect(game.of('bullet')[0]!.y).toBeLessThan(y - 20);
});

it('runs breakout motion and paddle control', () => {
  const game = play(paddleSource);
  const ball = () => game.of('ball')[0]!;
  const paddle = () => game.of('paddle')[0]!;
  const y = ball().y, x = paddle().x;
  game.step(20);
  expect(ball().y).toBeLessThan(y - 20);
  game.api.input.right = true; game.step(15);
  expect(paddle().x).toBeGreaterThan(x + 20);
});

it('runs flap gravity, lift and continuous pipe movement', () => {
  const game = play(flapSource);
  const bird = () => game.of('bird')[0]!;
  const pipes = () => game.of('pipe').map((pipe) => pipe.x);
  const y = bird().y, before = pipes();
  game.step(12);
  expect(bird().y).toBeGreaterThan(y + 10);
  expect(pipes()[0]).toBeLessThan(before[0]! - 15);
  const falling = bird().y;
  game.api.input.action = true; game.step(6);
  expect(bird().y).toBeLessThan(falling);
  game.api.input.action = false;
  const moved = pipes()[0]!;
  game.step(20);
  expect(pipes()[0]).toBeLessThan(moved - 20);
  for (let frame = 0; frame < 240 && game.score() === 0; frame += 1) {
    game.api.input.action = frame % 18 < 4; game.step(1);
  }
  expect(game.score()).toBe(1);
});
