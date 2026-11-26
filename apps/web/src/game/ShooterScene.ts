import Phaser from 'phaser';
import { TICK_RATE, bossOf, createSim, elapsedSeconds, isBoss, isEnraged, step, type ShooterInput, type ShooterLevel, type ShooterState } from '@game-creator/contracts';
import { hudLine, loseReason } from '../lib/shooter-text';
import { createBanner, createBaseUi, createBossUi, createHud, drawBoard, drawState } from './shooter-draw';

/** The boss's numbers for the hidden #game-hud (data-boss-*), empty strings when there is no boss on the field. */
function bossValues(state: ShooterState) {
  const boss = state.enemies.find((enemy) => isBoss(enemy.type) && enemy.maxHp !== undefined);
  if (!boss) return { bossHp: '', bossMax: '', bossAt: '', bossPhase: '', bossEnraged: '' };
  return {
    bossHp: String(boss.hp), bossMax: String(boss.maxHp), bossAt: `${Math.round(boss.x)},${Math.round(boss.y)}`, bossPhase: boss.bossPhase ?? '',
    bossEnraged: isEnraged(boss, bossOf(boss.type)!) ? 'yes' : 'no',
  };
}

const TICK_MS = 1000 / TICK_RATE;
/** Ticks run per frame to catch up after a slow frame. Beyond this the lag is dropped. */
const MAX_TICKS_PER_FRAME = 5;
type Keys = Record<'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;

/** Draws a ShooterState and reads input. The game itself is `createSim`/`step`
 * in the contracts package: this scene has no rules, no physics and no
 * collision of its own, so what is drawn is exactly what was simulated.
 * What is drawn lives in shooter-draw.ts; the sentences in lib/shooter-text.ts. */
export class ShooterScene extends Phaser.Scene {
  private state!: ShooterState;
  private art!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private banner: ReturnType<typeof createBanner> | undefined;
  private bossUi: ReturnType<typeof createBossUi>;
  private baseUi: ReturnType<typeof createBaseUi>;
  private bannerMs = 0;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | undefined;
  private keys: Keys | undefined;
  private accumulator = 0;
  private mouseDown = false;
  private pointerSeen = false;
  private finished = false;
  private lastHud = '';
  private lastPublished = '';

  constructor(private readonly level: ShooterLevel, private readonly onStarted: () => void) { super('shooter'); }

  create() {
    const { level } = this;
    this.state = createSim(level);
    this.accumulator = 0; this.mouseDown = false; this.pointerSeen = false; this.finished = false; this.lastHud = ''; this.lastPublished = ''; this.bannerMs = 0;
    this.cameras.main.setBackgroundColor(level.theme.background);

    drawBoard(this, level);
    this.hud = createHud(this, level);
    this.art = this.add.graphics().setDepth(5);
    // The goal, for the first 3 seconds of every game (and again after R). The game runs underneath.
    this.banner = createBanner(this, level);
    this.bossUi = createBossUi(this, level);
    this.baseUi = createBaseUi(this, level);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.banner?.dispose(); this.bossUi?.dispose(); this.baseUi?.dispose(); });

    this.setupControls();
    const result = document.getElementById('game-result');
    if (result) result.hidden = true;
    this.updateHud();
    this.publishState();
    this.draw();
    this.onStarted();
  }

  update(_time: number, delta: number) {
    if (this.finished) return;
    this.bannerMs += delta;
    this.banner?.update(this.bannerMs);
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
    this.bossUi?.update(this.state);
    this.baseUi?.update(this.state);
    this.updateHud();
    this.publishState();
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
    drawState(this.art, this.state, this.level);
  }

  private hudText(): string {
    const { state, level } = this;
    return hudLine(level.win, { hp: state.player.hp, maxHp: state.player.maxHp, score: state.score, kills: state.kills, seconds: elapsedSeconds(state) }, level.base !== undefined);
  }

  private updateHud() {
    const text = this.hudText();
    if (text === this.lastHud) return;
    this.lastHud = text;
    this.hud.setText(text);
    const status = document.getElementById('game-hud');
    if (status) { status.hidden = false; status.textContent = text; }
  }

  /** Read-only numbers on the hidden #game-hud element (data-*), for tests and assistive tools: the player's
   * health and place, how many enemy bullets are in the air, and the health pickups with their places. Nothing
   * reads them back into the game. Written only when they change. */
  private publishState() {
    const { state } = this;
    const at = (p: { x: number; y: number }) => `${Math.round(p.x)},${Math.round(p.y)}`;
    const values = {
      hp: String(state.player.hp), playerAt: at(state.player), enemyBullets: String(state.enemyBullets.length),
      pickups: String(state.pickups.length), pickupAt: state.pickups.map(at).join(';'),
      ...bossValues(state),
      // only in a level that has them: the base's hit points, the plates of the two bars as drawn, and who lost
      ...(state.base ? { baseHp: String(state.base.hp), baseMax: String(state.base.maxHp), baseBar: this.baseUi?.bounds() ?? '', lostBy: state.lostBy ?? '' } : {}),
      ...(this.bossUi ? { bossBar: this.bossUi.bounds() } : {}),
    };
    const key = Object.values(values).join('|');
    if (key === this.lastPublished) return;
    this.lastPublished = key;
    const status = document.getElementById('game-hud');
    if (status) Object.assign(status.dataset, values);
  }

  private finish() {
    this.finished = true;
    this.mouseDown = false;
    this.banner?.dispose();
    this.bossUi?.dispose();
    this.baseUi?.dispose();
    const { state, level } = this;
    const won = state.status === 'won';
    const result = document.getElementById('game-result');
    const title = document.getElementById('result-title');
    const detail = document.getElementById('result-detail');
    if (result && title && detail) {
      const how = !won ? loseReason(state.lostBy, level.base !== undefined) : level.win.type === 'survive' ? 'Bạn đã sống sót!' : level.win.type === 'kill' ? 'Bạn đã hạ đủ quái!' : 'Bạn đã hạ boss!';
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
