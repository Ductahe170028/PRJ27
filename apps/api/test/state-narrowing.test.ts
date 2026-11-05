import vm from 'node:vm';
import { expect, it } from 'vitest';
import { CodeValidator } from '../src/agent/code-validator.js';
import { narrowStateReads } from '../src/agent/state-narrowing.js';
import { flapSource, paddleSource, platformerSource, shooterSource, topDownSource } from './agent-fixtures.js';

const validator = new CodeValidator();
const game = (setup: string, update: string) => `function create(api: GameAPI): void { ${setup} }\nfunction update(api: GameAPI, dt: number): void { ${update} }`;

interface Entity { id: number; kind: string; x: number; y: number; width: number; height: number; color: number; vx: number; vy: number; hp: number; alive: boolean }
function execute(source: string) {
  const compiled = validator.validate(source);
  expect(compiled.errors, compiled.errors.join('\n')).toEqual([]);
  const context = { __budget() {}, create: (_api: object) => {}, update: (_api: object, _dt: number) => {} };
  vm.createContext(context);
  vm.runInContext(compiled.javascript ?? '', context);
  let next = 1;
  const entities = new Map<number, Entity>();
  const state: Record<string, number> = Object.create(null);
  const api = {
    width: 960, height: 540, time: 0,
    input: { left: false, right: false, up: false, down: false, action: false, pointerDown: false, pointerX: 0, pointerY: 0 },
    state,
    get entities() { return [...entities.values()]; },
    spawn(kind: string, x: number, y: number, width: number, height: number, color: number) {
      const entity: Entity = { id: next++, kind, x, y, width, height, color, vx: 0, vy: 0, hp: 1, alive: true };
      entities.set(entity.id, entity);
      return entity;
    },
    remove(entity: Entity) { entity.alive = false; entities.delete(entity.id); },
    get: (id: number) => entities.get(id),
    setPlayer() {}, overlaps() { return false; }, addScore() {}, status() {}, win() {}, lose() {},
  };
  context.create(api);
  return { state, entities, update: (dt = 1) => context.update(api, dt) };
}

function recordSpawns(source: string) {
  const compiled = validator.validate(source);
  expect(compiled.errors, compiled.errors.join('\n')).toEqual([]);
  const calls: Array<{ x: number; y: number; width: number; height: number }> = [];
  const context = { __budget() {}, create: (_api: object) => {}, update: (_api: object, _dt: number) => {} };
  vm.createContext(context);
  vm.runInContext(compiled.javascript ?? '', context);
  const api = {
    width: 960, height: 540, time: 0, state: Object.create(null) as Record<string, number>, entities: [] as unknown[],
    input: { left: false, right: false, up: false, down: false, action: false, pointerDown: false, pointerX: 0, pointerY: 0 },
    spawn(_kind: string, x: number, y: number, width: number, height: number, color: number) {
      calls.push({ x, y, width, height });
      return { id: calls.length, kind: _kind, x, y, width, height, color, vx: 0, vy: 0, hp: 1, alive: true };
    },
    get: () => undefined, remove() {}, setPlayer() {}, overlaps: () => false, addScore() {}, status() {}, win() {}, lose() {},
  };
  context.create(api);
  context.update(api, 0.016);
  return calls;
}

function scoreRun(source: string) {
  const compiled = validator.validate(source);
  expect(compiled.errors, compiled.errors.join('\n')).toEqual([]);
  const context = { __budget() {}, create: (_api: object) => {}, update: (_api: object, _dt: number) => {} };
  vm.createContext(context);
  vm.runInContext(compiled.javascript ?? '', context);
  let next = 1;
  let score = 0;
  const entities = new Map<number, Entity>();
  const state: Record<string, number> = Object.create(null);
  const api = {
    width: 960, height: 540, time: 0, state, input: { left: false, right: false, up: false, down: false, action: false, pointerDown: false, pointerX: 0, pointerY: 0 },
    get entities() { return [...entities.values()]; },
    spawn(kind: string, x: number, y: number, width: number, height: number, color: number) {
      const entity: Entity = { id: next++, kind, x, y, width, height, color, vx: 0, vy: 0, hp: 1, alive: true };
      entities.set(entity.id, entity);
      return entity;
    },
    get: (id: number) => entities.get(id), remove() {}, setPlayer() {}, overlaps: () => false, addScore(points: number) { score += points; }, status() {}, win() {}, lose() {},
  };
  context.create(api);
  return { step: (dt: number) => context.update(api, dt), get score() { return score; } };
}

it('leaves already valid fixtures untouched', () => {
  for (const source of [shooterSource, paddleSource, platformerSource, topDownSource, flapSource]) {
    expect(narrowStateReads(source).source).toBe(source);
  }
});

it('rewrites a counter update without turning a missing comparison into zero', () => {
  const missing = narrowStateReads(game('', 'api.state.pipeTimer += dt; if (api.state.pipeTimer >= api.state.pipeInterval) { api.state.hit = 1; }'));
  expect(missing.source).toContain('api.state.pipeTimer = (api.state.pipeTimer ?? 0) + dt');
  expect(missing.source).toContain('!== undefined');
  expect(missing.source).not.toContain('pipeInterval ?? 0');
  const missed = execute(missing.source);
  missed.update(0.05);
  expect(missed.state.pipeTimer).toBeCloseTo(0.05);
  expect(missed.state.hit).toBeUndefined();

  const ready = narrowStateReads(game('api.state.pipeTimer = 2; api.state.pipeInterval = 1;', 'if (api.state.pipeTimer >= api.state.pipeInterval) { api.state.hit = 1; }'));
  expect(ready.source).toContain('pipeTimer ?? 0');
  expect(ready.source).toContain('pipeInterval ?? 0');
  const played = execute(ready.source);
  played.update();
  expect(played.state.hit).toBe(1);
});

it('does not treat an uninitialized score >= 0 as true', () => {
  const missing = narrowStateReads(game('', 'if (api.state.score >= 0) { api.state.hit = 1; }'));
  expect(missing.source).toContain('!== undefined');
  expect(missing.source).not.toContain('?? 0');
  const missed = execute(missing.source);
  missed.update();
  expect(missed.state.hit).toBeUndefined();
  const ready = narrowStateReads(game('api.state.score = 0;', 'if (api.state.score >= 0) { api.state.hit = 1; }'));
  const readyPlay = execute(ready.source);
  readyPlay.update();
  expect(readyPlay.state.hit).toBe(1);
});

it('checks a missing entity id without substituting 0', () => {
  const missing = narrowStateReads(game('', 'const bird = api.get(api.state.player); if (bird) { api.state.hit = 1; }'));
  expect(missing.source).toContain('?? -1');
  expect(missing.source).not.toContain('?? 0');
  expect(execute(missing.source).state.hit).toBeUndefined();
  const ready = narrowStateReads(game('const bird = api.spawn("bird", 10, 10, 10, 10, 1); api.state.player = bird.id;', 'const bird = api.get(api.state.player); if (bird) { bird.x += 5; }'));
  expect(ready.source).toContain('?? -1');
  const played = execute(ready.source);
  played.update();
  expect([...played.entities.values()][0]?.x).toBe(15);
});

it('does not zero an uninitialized speed or rewrite an Entity stored in state', () => {
  const copied = game('', 'api.state.playerVY = api.state.jumpVel;');
  const copy = narrowStateReads(copied);
  expect(copy.source).toBe(copied);
  expect(copy.notes.join('\n')).toContain('api.state.jumpVel');
  const speed = game('const bird = api.spawn("bird", 30, 10, 10, 10, 1);', 'for (const e of api.entities) { e.x -= api.state.pipeSpeed * dt; }');
  const narrowed = narrowStateReads(speed);
  expect(narrowed.source).toBe(speed);
  expect(narrowed.notes.join('\n')).toContain('api.state.pipeSpeed');
  expect(narrowed.notes.join('\n')).toContain('Not an array');
  expect(validator.validate(narrowed.source).errors.join(' ')).toContain('undefined');

  const entity = game('api.state.bird = api.spawn("bird", 1, 2, 3, 4, 5); api.state.bird.vy = -10;', 'api.state.bird.x += 1;');
  const kept = narrowStateReads(entity);
  expect(kept.source).toBe(entity);
  expect(kept.notes.join('\n')).toContain('not an Entity');
  expect(validator.validate(kept.source).errors.length).toBeGreaterThan(0);
});

it('rewrites only a discarded increment and reports a value-producing one', () => {
  const discarded = narrowStateReads(game('', 'api.state.score++;'));
  expect(discarded.source).toContain('api.state.score = (api.state.score ?? 0) + 1');
  const played = execute(discarded.source);
  played.update();
  expect(played.state.score).toBe(1);
  const used = game('', 'api.addScore(api.state.score++);');
  const kept = narrowStateReads(used);
  expect(kept.source).toBe(used);
  expect(kept.notes.join('\n')).toContain('api.state.score++');
  expect(validator.validate(kept.source).errors.length).toBeGreaterThan(0);
});

it('does not hoist a loop condition into a one-shot zero check', () => {
  const source = game('', 'for (; api.state.score >= 0;) { api.state.hit = 1; break; }');
  const narrowed = narrowStateReads(source);
  expect(narrowed.source).toBe(source);
  expect(narrowed.source).not.toContain('?? 0');
  expect(validator.validate(narrowed.source).errors.length).toBeGreaterThan(0);
});

it('moves an initialized pipe and keeps the validator strict for an unannotated number', () => {
  const moving = narrowStateReads(game('api.state.pipeSpeed = 140; api.spawn("pipe", 80, 10, 10, 10, 1);', 'for (const e of api.entities) { e.x -= api.state.pipeSpeed * dt; }'));
  const played = execute(moving.source);
  played.update();
  expect([...played.entities.values()][0]?.x).toBe(-60);
  const annotated = game('', 'const value: number = api.state.score;');
  expect(narrowStateReads(annotated).source).toBe(annotated);
  expect(validator.validate(annotated).errors.join(' ')).toContain('api.state.score');
});

it('drops an undefined state write and guards api.get before overlaps', () => {
  const source = game(
    'api.state.playerId = undefined; const bird = api.spawn("bird", 40, 270, 30, 30, 1); api.state.playerId = bird.id;',
    'const player = api.get(api.state.playerId); for (const e of api.entities) { if (api.overlaps(e, player)) { api.lose(); } }',
  );
  expect(validator.validate(source).errors.join('\n')).toContain('undefined');
  const fixed = narrowStateReads(source).source;
    expect(fixed).not.toMatch(/[^=!]= undefined/);
  expect(fixed).toContain('player === undefined');
  expect(validator.validate(fixed).errors, validator.validate(fixed).errors.join('\n')).toEqual([]);
});

it('copies a numeric setup const into update and splits a pipe taller than 200 without gaps', () => {
  expect(validator.validate(game('', 'api.spawn("pipe", 80, 270, 20, 400, 1);')).errors.join('\n')).toContain('1 đến 200');
  const source = game(
    'const pipeGap = 150; api.state.pipeGap = pipeGap;',
    'const pipeHeight = 540; const yGap = 200; api.spawn("pipe", 80, yGap, 40, pipeHeight, 1); api.spawn("pipe", 300, yGap + pipeGap, 40, pipeHeight, 1);',
  );
  const fixed = narrowStateReads(source).source;
  expect(fixed).toContain('const pipeGap = 150');
  const calls = recordSpawns(fixed);
  expect(calls.length).toBeGreaterThan(2);
  const groups = new Map<number, Array<{ y: number; height: number; width: number }>>();
  for (const call of calls) {
    expect(call.width).toBeGreaterThanOrEqual(1);
    expect(call.width).toBeLessThanOrEqual(200);
    expect(call.height).toBeGreaterThanOrEqual(1);
    expect(call.height).toBeLessThanOrEqual(200);
    const key = Math.round(call.x);
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  expect(groups.size).toBe(2);
  for (const group of groups.values()) {
    const sorted = group.sort((left, right) => left.y - right.y);
    const top = sorted[0]!.y - sorted[0]!.height / 2;
    const bottom = sorted[sorted.length - 1]!.y + sorted[sorted.length - 1]!.height / 2;
    expect(bottom - top).toBeCloseTo(540);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]!;
      const next = sorted[index]!;
      expect(previous.y + previous.height / 2).toBeCloseTo(next.y - next.height / 2);
    }
  }
});

it('splits an unbraced spawn taller than 200 into touching segments', () => {
  const source = game('', 'const pipeHeight = 540; const yGap = 200; if (api.time >= 0) api.spawn("pipe", 80, yGap, 40, pipeHeight, 1);');
  const calls = recordSpawns(narrowStateReads(source).source);
  expect(calls.length).toBe(3);
  expect(calls.every((call) => call.height >= 1 && call.height <= 200 && call.width === 40)).toBe(true);
  const sorted = [...calls].sort((left, right) => left.y - right.y);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const next = sorted[index]!;
    expect(previous.y + previous.height / 2).toBeCloseTo(next.y - next.height / 2);
  }
});

it('stores the player id, coalesces a gap, primes the first pipe, and stacks a variable-height pipe', () => {
  const source = game(
    'const player = api.spawn("bird", 200, 270, 30, 30, 1); api.setPlayer(player); api.state.gap = 120; api.state.pipeSpawnTimer = 0;',
    `const playerId = api.state.playerId; if (playerId === undefined) { return; } const player = api.get(playerId); if (player === undefined) { return; }
     player.vy += 900 * dt;
     if ((api.state.pipeSpawnTimer ?? 0) >= 2) { api.state.pipeSpawnTimer = 0; const gap = api.state.gap; const yGap = 200; const upperHeight = yGap + 180; const lowerHeight = 540 - yGap - gap;
       api.spawn("upperPipe", 800, upperHeight / 2, 20, upperHeight, 2); api.spawn("lowerPipe", 800, yGap + gap + lowerHeight / 2, 20, lowerHeight, 2); }
     for (const e of api.entities) { if (e.kind === "upperPipe" || e.kind === "lowerPipe") { e.x -= 140 * dt; } }`,
  );
  const fixed = narrowStateReads(source).source;
  expect(fixed).toContain('api.state.playerId = player.id');
  expect(fixed).toContain('api.state.gap ?? 0');
  expect(fixed).toContain('api.state.pipeSpawnTimer = 2');
  expect(validator.validate(fixed).errors, validator.validate(fixed).errors.join('\n')).toEqual([]);
  expect(narrowStateReads(fixed).source).toBe(fixed);
  const played = execute(fixed);
  expect(played.state.playerId).toBeGreaterThan(0);
  played.update(0.016);
  expect([...played.entities.values()].find((entity) => entity.kind === 'bird')?.vy).toBeGreaterThan(0);
  const pipes = [...played.entities.values()].filter((entity) => entity.kind !== 'bird');
  expect(pipes.length).toBeGreaterThan(2);
  expect(pipes.every((entity) => entity.width >= 1 && entity.width <= 200 && entity.height >= 1 && entity.height <= 200)).toBe(true);
  for (const kind of ['upperPipe', 'lowerPipe']) {
    const sorted = pipes.filter((entity) => entity.kind === kind).sort((left, right) => left.y - right.y);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]!;
      const next = sorted[index]!;
      expect(previous.y + previous.height / 2).toBeCloseTo(next.y - next.height / 2);
    }
  }
});

it('stacks an unused const spawn when its height is computed and taller than 200', () => {
  const source = game(
    'api.state.gap = 120; const gapY = 400; const upperHeight = gapY - (api.state.gap ?? 0) / 2; const upper = api.spawn("upperPipe", 800, upperHeight / 2, 50, upperHeight, 1);',
    '',
  );
  const fixed = narrowStateReads(source).source;
  expect(validator.validate(fixed).errors, validator.validate(fixed).errors.join('\n')).toEqual([]);
  expect(narrowStateReads(fixed).source).toBe(fixed);
  const calls = recordSpawns(fixed);
  expect(calls.length).toBeGreaterThan(1);
  expect(calls.every((call) => call.width === 50 && call.height >= 1 && call.height <= 200)).toBe(true);
  const sorted = [...calls].sort((left, right) => left.y - right.y);
  const top = sorted[0]!.y - sorted[0]!.height / 2;
  const bottom = sorted[sorted.length - 1]!.y + sorted[sorted.length - 1]!.height / 2;
  expect(bottom - top).toBeCloseTo(340);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const next = sorted[index]!;
    expect(previous.y + previous.height / 2).toBeCloseTo(next.y - next.height / 2);
  }
});

it('tells repair to move a setup function into helpers', () => {
  const source = game('const spawnPipe = () => { api.spawn("pipe", 10, 10, 20, 20, 1); }; spawnPipe();', 'spawnPipe();');
  const notes = narrowStateReads(source).notes.join('\n');
  expect(notes).toContain('helpers');
  expect(notes).not.toContain('api.state.spawnPipe');
});

it('scores each upper pipe once when it passes the player', () => {
  const source = game(
    'const bird = api.spawn("bird", 80, 200, 20, 20, 1); api.setPlayer(bird); api.state.player = bird.id; api.spawn("upperPipe", 200, 80, 20, 160, 2); api.spawn("upperPipe", 400, 80, 20, 160, 2);',
    `const playerId = api.state.player; if (playerId === undefined) { return; } const player = api.get(playerId); if (player === undefined) { return; }
     for (const e of api.entities) { if (e.kind === "upperPipe") { e.x -= 100 * dt; const scored = api.state.lastScored; if (e.x < player.x && (scored === undefined || e.id > scored)) { api.state.lastScored = e.id; api.addScore(1); } } }`,
  );
  const played = scoreRun(source);
  played.step(1.5);
  expect(played.score).toBe(1);
  played.step(1);
  expect(played.score).toBe(1);
  played.step(2);
  expect(played.score).toBe(2);
  played.step(2);
  expect(played.score).toBe(2);
});

it('typechecks the final Groq Flappy repair without changing an uninitialized comparison', () => {
  const narrowed = narrowStateReads(run3);
  expect(validator.validate(narrowed.source).errors, validator.validate(narrowed.source).errors.join('\n')).toEqual([]);
  expect(narrowStateReads(narrowed.source).source).toBe(narrowed.source);
  expect(validator.validate(game('const top = api.spawn("pipe", 1, 2, 3, 4, 5);', '')).errors.join(' ')).toContain('top');
});

const run3 = `function create(api: GameAPI): void {
api.state.score=0;api.state.player=0;api.state.pipeTimer=0;api.state.pipeInterval=1.5;api.state.pipeGap=120;api.state.pipeSpeed=140;api.state.pipeHeight=20;api.state.pipeWidth=50;api.state.pipeCount=0;api.state.gameOver=0;api.state.restartTimer=0;api.state.gameStart=0;api.state.lastPipeX=api.width+api.state.pipeWidth;api.state.pipeSpawnX=api.width+api.state.pipeWidth;api.state.pipeGapY=0;api.state.playerY=api.height/2;api.state.playerX=100;api.state.playerVY=0;api.state.gravity=900;api.state.jumpVel=-300;api.state.birdWidth=30;api.state.birdHeight=30;api.state.birdColor=0xff0000;api.state.pipeColor=0x00ff00;var bird=api.spawn("bird",api.state.playerX,api.state.playerY,api.state.birdWidth,api.state.birdHeight,api.state.birdColor);api.setPlayer(bird);bird.vy=api.state.playerVY;bird.x=api.state.playerX;bird.y=api.state.playerY;bird.alive=true;bird.hp=1;bird.kind="bird";api.state.player=bird.id;
}
function update(api: GameAPI, dt: number): void {
if(api.state.gameOver){api.state.restartTimer=(api.state.restartTimer??0)+dt;if(api.state.restartTimer>=1){api.state.gameOver=0;api.state.score=0;api.state.playerVY=0;api.state.playerY=api.height/2;var p=api.get(api.state.player??0);if(p){p.y=api.height/2;p.vy=0;}api.state.pipeTimer=0;api.state.restartTimer=0;api.state.lastPipeX=api.width+api.state.pipeWidth;api.state.pipeGapY=0;api.state.pipeCount=0;api.state.gameStart=0;}return;}if(!api.state.gameStart){api.state.gameStart=1;}api.state.pipeTimer=(api.state.pipeTimer??0)+dt;if(api.state.pipeTimer>=api.state.pipeInterval){api.state.pipeTimer=0;api.state.lastPipeX=api.width+api.state.pipeWidth;api.state.pipeGapY=Math.random()*(api.height-2*api.state.pipeGap-2*api.state.pipeHeight);var topPipe=api.spawn("pipe",api.state.lastPipeX,api.state.pipeGapY,api.state.pipeWidth,api.state.pipeHeight,api.state.pipeColor);topPipe.kind="pipe";topPipe.alive=true;var bottomPipe=api.spawn("pipe",api.state.lastPipeX,api.state.pipeGapY+api.state.pipeGap,api.state.pipeWidth,api.state.pipeHeight,api.state.pipeColor);bottomPipe.kind="pipe";bottomPipe.alive=true;api.state.pipeCount+=1;}for(const e of api.entities){if(e.kind=="pipe"){e.x-=api.state.pipeSpeed*dt;if(e.x+e.width<0){api.remove(e);}}}api.state.playerVY+=api.state.gravity*dt;api.state.playerY+=api.state.playerVY*dt;if(api.input.action||api.input.pointerDown){api.state.playerVY=api.state.jumpVel;}var p=api.get(api.state.player??0);if(p){p.y=api.state.playerY;p.vy=api.state.playerVY;}for(const e of api.entities){if(e.kind=="pipe"){if(p&&api.overlaps(p,e)){api.state.gameOver=1;}}}if(api.state.playerY<0||api.state.playerY>api.height){api.state.gameOver=1;}if(api.state.pipeCount>0){var birdX=p?p.x+p.width/2:0;if(birdX>api.state.lastPipeX){api.addScore(1);api.state.score+=1;api.state.pipeCount-=1;if(api.state.score>=10){api.state.gameOver=1;api.win();}}}
}
`;
