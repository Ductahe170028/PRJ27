import Phaser from 'phaser';
import {
  BULLET_RADIUS, ENEMY_TYPES, FIELD, PLAYER_RADIUS, TICK_RATE, createSim, elapsedSeconds, step,
  type ShooterInput, type ShooterLevel, type ShooterState,
} from '@game-creator/contracts';

const color = (hex: string) => Number.parseInt(hex.slice(1), 16);
/** Scales each channel of #rrggbb by `factor` (<1 darker, >1 lighter, capped). */
function shade(hex: string, factor: number): number {
  const value = color(hex);
  const channel = (shift: number) => Math.min(255, Math.round(((value >> shift) & 255) * factor));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

const TICK_MS = 1000 / TICK_RATE;
/** Ticks run per frame to catch up after a slow frame. Beyond this the lag is dropped. */
const MAX_TICKS_PER_FRAME = 5;
type Keys = Record<'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;

/** Draws a ShooterState and reads input. The game itself is `createSim`/`step`
 * in the contracts package: this scene has no rules, no physics and no
 * collision of its own, so what is drawn is exactly what was simulated. */
export class ShooterScene extends Phaser.Scene {
  private state!: ShooterState;
  private art!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | undefined;
  private keys: Keys | undefined;
  private accumulator = 0;
  private mouseDown = false;
  private pointerSeen = false;
  private finished = false;
  private lastHud = '';

  constructor(private readonly level: ShooterLevel, private readonly onStarted: () => void) { super('shooter'); }

  create() {
    const { level } = this;
    this.state = createSim(level);
    this.accumulator = 0; this.mouseDown = false; this.pointerSeen = false; this.finished = false; this.lastHud = '';
    this.cameras.main.setBackgroundColor(level.theme.background);

    const board = this.add.graphics();
    board.lineStyle(1, color(level.theme.accent), 0.09);
    for (let x = 0; x < 960; x += 40) board.lineBetween(x, FIELD.top, x, FIELD.bottom);
    for (let y = FIELD.top + 10; y < FIELD.bottom; y += 40) board.lineBetween(0, y, 960, y);
    for (const block of level.obstacles) {
      board.fillStyle(color(level.theme.wall), 1).fillRect(block.x - block.width / 2, block.y - block.height / 2, block.width, block.height);
      board.lineStyle(2, color(level.theme.accent), 0.7).strokeRect(block.x - block.width / 2, block.y - block.height / 2, block.width, block.height);
    }
    this.add.rectangle(480, 35, 960, 70, 0x060d18, 0.8).setDepth(8);
    this.add.text(22, 12, level.title, { fontFamily: 'system-ui', fontSize: '20px', color: '#ffffff' }).setDepth(9);
    this.hud = this.add.text(22, 43, '', { fontFamily: 'system-ui', fontSize: '13px', color: '#d6e1ee' }).setDepth(10);
    this.add.text(938, 18, 'SURVIVAL SHOOTER', { fontFamily: 'monospace', fontSize: '12px', color: level.theme.accent }).setOrigin(1, 0).setDepth(9);
    this.art = this.add.graphics().setDepth(5);

    this.setupControls();
    const result = document.getElementById('game-result');
    if (result) result.hidden = true;
    this.updateHud();
    this.draw();
    this.onStarted();
  }

  update(_time: number, delta: number) {
    if (this.finished) return;
    this.accumulator += Math.min(delta, 250);
    const input = this.readInput();
    let ticks = 0;
    while (this.accumulator >= TICK_MS && ticks < MAX_TICKS_PER_FRAME && this.state.status === 'playing') {
      step(this.state, input);
      this.accumulator -= TICK_MS;
      ticks += 1;
    }
    if (ticks === MAX_TICKS_PER_FRAME) this.accumulator = 0; // too far behind: drop the rest
    this.draw();
    this.updateHud();
    if (this.state.status !== 'playing') this.finish();
  }

  private readInput(): ShooterInput {
    const keys = this.keys;
    const cursors = this.cursors;
    const held = (arrow: Phaser.Input.Keyboard.Key | undefined, letter: Phaser.Input.Keyboard.Key | undefined) =>
      Number(Boolean(arrow?.isDown) || Boolean(letter?.isDown));
    const pointer = this.input.activePointer;
    const { player } = this.state;
    return {
      moveX: (held(cursors?.right, keys?.d) - held(cursors?.left, keys?.a)) as -1 | 0 | 1,
      moveY: (held(cursors?.down, keys?.s) - held(cursors?.up, keys?.w)) as -1 | 0 | 1,
      // Until the mouse has moved over the game, aim to the right of the player.
      aimX: this.pointerSeen ? pointer.worldX : player.x + 100,
      aimY: this.pointerSeen ? pointer.worldY : player.y,
      fire: this.mouseDown,
    };
  }

  private draw() {
    const { state, level } = this;
    const { player } = state;
    const g = this.art;
    g.clear();
    for (const enemy of state.enemies) {
      const kind = ENEMY_TYPES[enemy.type];
      if (enemy.type === 'brute') {
        g.fillStyle(shade(level.theme.enemy, 0.55), 1).fillCircle(enemy.x, enemy.y, kind.radius);
        g.lineStyle(3, color(level.theme.enemy), 1).strokeCircle(enemy.x, enemy.y, kind.radius - 1.5);
        // hit points left, as the share of an inner disk
        g.fillStyle(color(level.theme.enemy), 1).fillCircle(enemy.x, enemy.y, (kind.radius - 6) * (enemy.hp / kind.hp));
      } else {
        g.fillStyle(enemy.type === 'swarmer' ? shade(level.theme.enemy, 1.2) : color(level.theme.enemy), 1).fillCircle(enemy.x, enemy.y, kind.radius);
        g.lineStyle(1.5, 0x101b30, 0.8).strokeCircle(enemy.x, enemy.y, kind.radius);
      }
    }
    g.fillStyle(color(level.theme.bullet), 1);
    for (const bullet of state.bullets) g.fillCircle(bullet.x, bullet.y, BULLET_RADIUS);
    // The player blinks while protected; the barrel points where it aims.
    const protectedNow = state.tick < player.invulnerableUntilTick && Math.floor(state.tick / 5) % 2 === 0;
    const alpha = protectedNow ? 0.35 : 1;
    const dx = Math.cos(player.aim);
    const dy = Math.sin(player.aim);
    g.lineStyle(6, 0xffffff, alpha).lineBetween(player.x + dx * 6, player.y + dy * 6, player.x + dx * (PLAYER_RADIUS + 9), player.y + dy * (PLAYER_RADIUS + 9));
    g.fillStyle(color(level.theme.player), alpha).fillCircle(player.x, player.y, PLAYER_RADIUS);
    g.lineStyle(2, 0x101b30, alpha).strokeCircle(player.x, player.y, PLAYER_RADIUS);
  }

  private hudText(): string {
    const { state, level } = this;
    const seconds = Math.floor(elapsedSeconds(state));
    const goal = level.win.type === 'survive' ? `Sống sót ${Math.min(seconds, level.win.seconds)}/${level.win.seconds}s` : `Mục tiêu hạ ${level.win.count}`;
    return `Máu ${state.player.hp}/${state.player.maxHp}  ·  Điểm ${state.score}  ·  Hạ ${state.kills}  ·  ${goal}  ·  R: chơi lại`;
  }

  private updateHud() {
    const text = this.hudText();
    if (text === this.lastHud) return;
    this.lastHud = text;
    this.hud.setText(text);
    const status = document.getElementById('game-hud');
    if (status) { status.hidden = false; status.textContent = text; }
  }

  private finish() {
    this.finished = true;
    this.mouseDown = false;
    const { state, level } = this;
    const won = state.status === 'won';
    const result = document.getElementById('game-result');
    const title = document.getElementById('result-title');
    const detail = document.getElementById('result-detail');
    if (result && title && detail) {
      const how = !won ? 'Bạn đã hết máu.' : level.win.type === 'survive' ? 'Bạn đã sống sót!' : 'Bạn đã hạ đủ quái!';
      title.textContent = won ? 'Bạn thắng!' : 'Game over';
      detail.textContent = `${how} Điểm: ${state.score}. Hạ: ${state.kills}.`;
      result.hidden = false;
    }
    this.updateHud();
  }

  private setupControls() {
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.keys = this.input.keyboard?.addKeys('w,a,s,d', true, false) as Keys | undefined;
    this.input.keyboard?.addCapture(['UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE', 'W', 'A', 'S', 'D']);
    this.input.mouse?.disableContextMenu();
    this.input.setDefaultCursor('crosshair');

    const restart = (event?: KeyboardEvent) => { if (!event?.repeat) this.scene.restart(); };
    const press = (pointer: Phaser.Input.Pointer) => { if (pointer.leftButtonDown()) this.mouseDown = true; };
    const release = (pointer: Phaser.Input.Pointer) => { if (!pointer.leftButtonDown()) this.mouseDown = false; };
    const move = () => { this.pointerSeen = true; };
    // Losing focus must not leave a key or the trigger held down.
    const clear = () => { this.mouseDown = false; this.input.keyboard?.resetKeys(); };
    this.input.keyboard?.on('keydown-R', restart);
    this.input.on('pointerdown', press);
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
    this.input.on('pointermove', move);
    window.addEventListener('blur', clear);
    const button = document.getElementById('restart-game');
    const onButton = () => restart();
    button?.addEventListener('click', onButton);
    // The touch buttons belong to the other games; this one has no touch controls yet.
    for (const id of ['move-left', 'move-right', 'move-up', 'move-down', 'jump']) {
      const element = document.getElementById(id);
      if (element) element.hidden = true;
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-R', restart);
      this.input.off('pointerdown', press);
      this.input.off('pointerup', release);
      this.input.off('pointerupoutside', release);
      this.input.off('pointermove', move);
      window.removeEventListener('blur', clear);
      button?.removeEventListener('click', onButton);
      this.input.setDefaultCursor('default');
    });
  }
}
