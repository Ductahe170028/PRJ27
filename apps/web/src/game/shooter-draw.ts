// Drawing for the shooter, one function per thing on screen. Nothing here has a rule or a collision:
// it reads a ShooterState (or a level) and paints it. ShooterScene owns the loop and the input.
import Phaser from 'phaser';
import {
  BULLET_RADIUS, ENEMY_TYPES, FIELD, PLAYER_RADIUS,
  type EnemyType, type ShooterLevel, type ShooterState,
} from '@game-creator/contracts';
import { BANNER_HINT, bannerAlpha, bannerTextColor, bannerTitle } from '../lib/shooter-text';

export const color = (hex: string) => Number.parseInt(hex.slice(1), 16);
/** Scales each channel of #rrggbb by `factor` (<1 darker, >1 lighter, capped). */
export function shade(hex: string, factor: number): number {
  const value = color(hex);
  const channel = (shift: number) => Math.min(255, Math.round(((value >> shift) & 255) * factor));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** How a kind of enemy looks. One row per kind (a missing row is a compile error): `plain` is a disk,
 * `armored` is a ring with an inner disk that shrinks with its hit points. `shade` darkens (<1) or lightens (>1) the theme color. */
interface EnemyLook { style: 'plain' | 'armored'; shade: number }
export const ENEMY_LOOKS: Record<EnemyType, EnemyLook> = {
  runner: { style: 'plain', shade: 1 },
  brute: { style: 'armored', shade: 0.55 },
  swarmer: { style: 'plain', shade: 1.2 },
};

/** The ground grid and the obstacles: drawn once per game. */
export function drawBoard(scene: Phaser.Scene, level: ShooterLevel) {
  const board = scene.add.graphics();
  board.lineStyle(1, color(level.theme.accent), 0.09);
  for (let x = 0; x < 960; x += 40) board.lineBetween(x, FIELD.top, x, FIELD.bottom);
  for (let y = FIELD.top + 10; y < FIELD.bottom; y += 40) board.lineBetween(0, y, 960, y);
  drawObstacles(board, level);
}

function drawObstacles(g: Phaser.GameObjects.Graphics, level: ShooterLevel) {
  for (const block of level.obstacles) {
    g.fillStyle(color(level.theme.wall), 1).fillRect(block.x - block.width / 2, block.y - block.height / 2, block.width, block.height);
    g.lineStyle(2, color(level.theme.accent), 0.7).strokeRect(block.x - block.width / 2, block.y - block.height / 2, block.width, block.height);
  }
}

export function drawEnemies(g: Phaser.GameObjects.Graphics, state: ShooterState, level: ShooterLevel) {
  for (const enemy of state.enemies) {
    const kind = ENEMY_TYPES[enemy.type];
    const look = ENEMY_LOOKS[enemy.type];
    if (look.style === 'armored') {
      g.fillStyle(shade(level.theme.enemy, look.shade), 1).fillCircle(enemy.x, enemy.y, kind.radius);
      g.lineStyle(3, color(level.theme.enemy), 1).strokeCircle(enemy.x, enemy.y, kind.radius - 1.5);
      // hit points left, as the share of an inner disk
      g.fillStyle(color(level.theme.enemy), 1).fillCircle(enemy.x, enemy.y, (kind.radius - 6) * (enemy.hp / kind.hp));
    } else {
      g.fillStyle(shade(level.theme.enemy, look.shade), 1).fillCircle(enemy.x, enemy.y, kind.radius);
      g.lineStyle(1.5, 0x101b30, 0.8).strokeCircle(enemy.x, enemy.y, kind.radius);
    }
  }
}

export function drawBullets(g: Phaser.GameObjects.Graphics, state: ShooterState, level: ShooterLevel) {
  g.fillStyle(color(level.theme.bullet), 1);
  for (const bullet of state.bullets) g.fillCircle(bullet.x, bullet.y, BULLET_RADIUS);
}

/** The player blinks while protected; the barrel points where it aims. */
export function drawPlayer(g: Phaser.GameObjects.Graphics, state: ShooterState, level: ShooterLevel) {
  const { player } = state;
  const protectedNow = state.tick < player.invulnerableUntilTick && Math.floor(state.tick / 5) % 2 === 0;
  const alpha = protectedNow ? 0.35 : 1;
  const dx = Math.cos(player.aim);
  const dy = Math.sin(player.aim);
  g.lineStyle(6, 0xffffff, alpha).lineBetween(player.x + dx * 6, player.y + dy * 6, player.x + dx * (PLAYER_RADIUS + 9), player.y + dy * (PLAYER_RADIUS + 9));
  g.fillStyle(color(level.theme.player), alpha).fillCircle(player.x, player.y, PLAYER_RADIUS);
  g.lineStyle(2, 0x101b30, alpha).strokeCircle(player.x, player.y, PLAYER_RADIUS);
}

/** Everything that moves, in the order it is painted (the barrel is part of the player). */
export function drawState(g: Phaser.GameObjects.Graphics, state: ShooterState, level: ShooterLevel) {
  g.clear();
  drawEnemies(g, state, level);
  drawBullets(g, state, level);
  drawPlayer(g, state, level);
}

/** The bar on top: title, the HUD line (updated by the scene) and the game's name. */
export function createHud(scene: Phaser.Scene, level: ShooterLevel): Phaser.GameObjects.Text {
  scene.add.rectangle(480, 35, 960, 70, 0x060d18, 0.8).setDepth(8);
  scene.add.text(22, 12, level.title, { fontFamily: 'system-ui', fontSize: '20px', color: '#ffffff' }).setDepth(9);
  const hud = scene.add.text(22, 43, '', { fontFamily: 'system-ui', fontSize: '13px', color: '#d6e1ee' }).setDepth(10);
  scene.add.text(938, 18, 'SURVIVAL SHOOTER', { fontFamily: 'monospace', fontSize: '12px', color: level.theme.accent }).setOrigin(1, 0).setDepth(9);
  return hud;
}

/** The goal and the controls, in the upper middle of the field for the first 3 seconds of real time.
 * It is only painted over the game: it never pauses it. `update(ms)` takes the real time since the
 * scene started; at 3 s the banner is removed. `dispose()` removes it early (the scene is shutting down).
 * The same words are also in a visually hidden `#game-banner` element, for screen readers and for tests
 * (the canvas has no text a test can read). */
export function createBanner(scene: Phaser.Scene, level: ShooterLevel): { update(elapsedMs: number): void; dispose(): void } {
  const text = bannerTextColor(level.theme);
  const note = document.createElement('p');
  note.id = 'game-banner';
  note.setAttribute('role', 'status');
  note.textContent = `${bannerTitle(level.win)}. ${BANNER_HINT}`;
  Object.assign(note.style, { position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: '0', overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' });
  document.getElementById('game-banner')?.remove();
  document.body.appendChild(note);
  const plate = scene.add.rectangle(480, 205, 700, 86, 0x060d18, 0.62).setDepth(20);
  const title = scene.add.text(480, 188, bannerTitle(level.win), {
    fontFamily: 'system-ui', fontSize: '32px', fontStyle: 'bold', color: text, stroke: '#060d18', strokeThickness: 5,
  }).setOrigin(0.5).setDepth(21);
  const hint = scene.add.text(480, 226, BANNER_HINT, {
    fontFamily: 'system-ui', fontSize: '16px', color: '#ffffff', stroke: '#060d18', strokeThickness: 4,
  }).setOrigin(0.5).setDepth(21);
  const parts = [plate, title, hint];
  let gone = false;
  const dispose = () => {
    if (gone) return;
    gone = true;
    for (const part of parts) part.destroy();
    note.remove();
  };
  return {
    update(elapsedMs: number) {
      if (gone) return;
      const alpha = bannerAlpha(elapsedMs);
      if (alpha <= 0) { dispose(); return; }
      plate.setAlpha(alpha); // on top of the plate's own 0.62
      title.setAlpha(alpha);
      hint.setAlpha(alpha);
    },
    dispose,
  };
}
