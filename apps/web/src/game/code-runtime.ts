import Phaser from 'phaser';
import { CODE_MAX_ENTITIES } from '@game-creator/contracts/code-limits';

interface Entity { id: number; kind: string; x: number; y: number; width: number; height: number; color: number; vx: number; vy: number; hp: number; alive: boolean }
interface GameAPI {
  readonly width: number; readonly height: number; readonly time: number;
  readonly input: { left: boolean; right: boolean; up: boolean; down: boolean; action: boolean; pointerDown: boolean; pointerX: number; pointerY: number };
  readonly state: Record<string, number>; readonly entities: Entity[];
  spawn(kind: string, x: number, y: number, width: number, height: number, color: number): Entity;
  get(id: number): Entity | undefined; remove(entity: Entity): void; setPlayer(entity: Entity): void;
  overlaps(a: Entity, b: Entity): boolean; addScore(points: number): void; status(text: string): void; win(): void; lose(): void;
}
interface Hooks { create(api: GameAPI): void; update(api: GameAPI, dt: number): void }
declare global { var __gameAgentBoot: (factory: (budget: () => void) => Hooks) => void }
const sessionId = document.querySelector('#code-runtime')?.getAttribute('data-session') ?? '';
const hud = document.querySelector<HTMLElement>('#code-hud')!;
const result = document.querySelector<HTMLElement>('#code-result')!;
const send = (type: string, data: Record<string, unknown> = {}) => parent.postMessage({ channel: 'code-runtime', sessionId, type, ...data }, '*');
let game: Phaser.Game | undefined;
let stopped = false;
const fail = (message: string) => {
  if (stopped) return;
  stopped = true; send('error', { message: message.slice(0, 400) });
  result.hidden = false; result.textContent = 'Game đã dừng do lỗi runtime.';
  game?.loop.stop();
};
window.addEventListener('error', (event) => fail(event.message));
window.addEventListener('unhandledrejection', () => fail('Unhandled runtime rejection'));
window.addEventListener('securitypolicyviolation', (event) => fail(`Sandbox chặn ${event.violatedDirective} (${event.blockedURI.split(':')[0]?.slice(0, 30) ?? 'resource'}).`));
const finite = (value: number, bound = 100_000) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > bound) throw new Error('Giá trị game không hữu hạn hoặc vượt giới hạn.');
};

globalThis.__gameAgentBoot = (factory) => {
  delete (globalThis as Partial<typeof globalThis>).__gameAgentBoot;
  let operations = 0, deadline = 0;
  const budget = () => { if (++operations > 5000 || performance.now() > deadline) throw new Error('Game vượt ngân sách vòng lặp/CPU mỗi frame.'); };
  const hooks = factory(budget);
  let frames = 0, restarts = -1, score = 0, elapsed = 0, playerId = 0, nextId = 1, ended = false, label = '';
  let state: Record<string, number> = Object.create(null) as Record<string, number>;
  const entities = new Map<number, Entity>();
  const shapes = new Map<number, Phaser.GameObjects.Rectangle>();
  let scene: Phaser.Scene;
  let keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  const snapshot = () => ({ frames, restarts, score, objects: entities.size, ended,
    playerX: entities.get(playerId)?.x ?? null, playerY: entities.get(playerId)?.y ?? null });
  const heartbeat = window.setInterval(() => { if (!stopped) send('heartbeat', { stats: snapshot() }); }, 500);
  window.setTimeout(() => { clearInterval(heartbeat); fail('Đã hết phiên preview 10 phút. Tạo lại game để tiếp tục.'); }, 600_000);
  const finish = (won: boolean) => { ended = true; result.hidden = false; result.textContent = won ? 'Bạn thắng!' : 'Game over'; };
  const api: GameAPI = Object.freeze({
    width: 960, height: 540,
    get time() { return elapsed; }, get state() { return state; }, get entities() { return [...entities.values()]; },
    get input() {
      const down = (name: string) => keys[name]?.isDown ?? false;
      return Object.freeze({ left: down('LEFT') || down('A'), right: down('RIGHT') || down('D'), up: down('UP') || down('W'), down: down('DOWN') || down('S'),
        action: down('SPACE'), pointerDown: scene.input.activePointer.isDown, pointerX: scene.input.activePointer.x, pointerY: scene.input.activePointer.y });
    },
    spawn(kind: string, x: number, y: number, width: number, height: number, color: number): Entity {
      budget();
      if (entities.size >= CODE_MAX_ENTITIES) throw new Error('Quá 160 vật thể. Hãy thu hồi vật thể ngoài màn hình.');
      if (typeof kind !== 'string' || kind.length > 40) throw new Error('Tên vật thể không hợp lệ.');
      const entity: Entity = Object.assign(Object.create(null) as Entity, { id: nextId++, kind, x, y, width, height, color, vx: 0, vy: 0, hp: 1, alive: true });
      validateEntity(entity); Object.seal(entity);
      entities.set(entity.id, entity); shapes.set(entity.id, scene.add.rectangle(x, y, width, height, color));
      return entity;
    },
    get(id: number) { return entities.get(id); },
    remove(entity: Entity) { entities.delete(entity.id); shapes.get(entity.id)?.destroy(); shapes.delete(entity.id); entity.alive = false; },
    setPlayer(entity: Entity) { if (!entities.has(entity.id)) throw new Error('Player chưa được spawn.'); playerId = entity.id; },
    overlaps(a: Entity, b: Entity) { return a.alive && b.alive && Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2; },
    addScore(points: number) { finite(points, 10000); score += points; finite(score, 10_000_000); },
    status(text: string) { if (typeof text !== 'string' || text.length > 160) throw new Error('Status tối đa 160 ký tự.'); label = text; },
    win() { finish(true); }, lose() { finish(false); },
  });
  function validateEntity(entity: Entity) {
    for (const value of [entity.x, entity.y, entity.vx, entity.vy, entity.hp]) finite(value);
    if (entity.width < 1 || entity.width > 200 || entity.height < 1 || entity.height > 200) throw new Error('Kích thước vật thể phải từ 1 đến 200.');
    finite(entity.width); finite(entity.height); finite(entity.color, 0xffffff);
  }
  function invoke(task: () => void) { operations = 0; deadline = performance.now() + 20; task(); }
  function restart() {
    if (stopped) return;
    try {
      for (const shape of shapes.values()) shape.destroy();
      shapes.clear(); entities.clear(); state = Object.create(null) as Record<string, number>;
      elapsed = 0; score = 0; nextId = 1; playerId = 0; ended = false; label = ''; restarts += 1; result.hidden = true;
      invoke(() => hooks.create(api));
      send('started', { stats: snapshot() });
    } catch (error) { fail(error instanceof Error ? error.message : 'Lỗi trong create().'); }
  }
  class CodeScene extends Phaser.Scene {
    create() {
      scene = this;
      keys = this.input.keyboard!.addKeys('LEFT,RIGHT,UP,DOWN,W,A,S,D,SPACE,R') as Record<string, Phaser.Input.Keyboard.Key>;
      this.input.keyboard!.on('keydown-R', restart);
      document.querySelector('#code-restart')?.addEventListener('click', restart);
      this.game.canvas.tabIndex = 0;
      this.game.canvas.addEventListener('pointerdown', () => this.game.canvas.focus());
      restart();
    }
    update(_time: number, delta: number) {
      if (stopped) return;
      try {
        frames += 1;
        if (!ended) {
          const dt = Math.min(0.05, delta / 1000); elapsed += dt;
          invoke(() => hooks.update(api, dt));
        }
        if (Object.keys(state).length > 256) throw new Error('Quá 256 trường state.');
        for (const value of Object.values(state)) finite(value, 10_000_000);
        for (const entity of entities.values()) {
          if (!entity.alive) { api.remove(entity); continue; }
          validateEntity(entity);
          shapes.get(entity.id)?.setPosition(entity.x, entity.y).setSize(entity.width, entity.height).setFillStyle(entity.color);
        }
        hud.textContent = `Điểm ${score} · ${label}`;
      } catch (error) { fail(error instanceof Error ? error.message : 'Lỗi trong update().'); }
    }
  }
  game = new Phaser.Game({ type: Phaser.CANVAS, width: 960, height: 540, parent: 'game', backgroundColor: '#0b1321',
    banner: false, audio: { noAudio: true }, scene: [CodeScene], scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } });
};
