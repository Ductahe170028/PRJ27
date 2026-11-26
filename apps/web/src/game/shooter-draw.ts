// Drawing for the shooter, one function per thing on screen. Nothing here has a rule or a collision:
// it reads a ShooterState (or a level) and paints it. ShooterScene owns the loop and the input.
import Phaser from 'phaser';
import {
  BASE_SIZE, BULLET_RADIUS, ENEMY_TYPES, FIELD, PLAYER_RADIUS, bossOf, bossWaveOf, isBoss, isEnraged,
  type EnemyType, type ShooterEnemy, type ShooterLevel, type ShooterState,
} from '@game-creator/contracts';
import {
  BANNER_HINT, BASE_BAR, BASE_BAR_LABEL, BASE_BAR_PLATE, BOSS_WARNING_TEXT, bannerAlpha, bannerLines, bannerTextColor, bannerTitle, baseBar, bossBar, bossWarningAlpha,
} from '../lib/shooter-text';

export const color = (hex: string) => Number.parseInt(hex.slice(1), 16);
/** Scales each channel of #rrggbb by `factor` (<1 darker, >1 lighter, capped). */
export function shade(hex: string, factor: number): number {
  const value = color(hex);
  const channel = (shift: number) => Math.min(255, Math.round(((value >> shift) & 255) * factor));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** How a kind of enemy looks. One row per kind (a missing row is a compile error): `plain` is a disk,
 * `armored` is a ring with an inner disk that shrinks with its hit points. `shade` darkens (<1) or lightens (>1) the theme color. */
interface EnemyLook { style: 'plain' | 'armored' | 'diamond' | 'spiked' | 'turret'; shade: number }
export const ENEMY_LOOKS: Record<EnemyType, EnemyLook> = {
  runner: { style: 'plain', shade: 1 },
  brute: { style: 'armored', shade: 0.55 },
  swarmer: { style: 'plain', shade: 1.2 },
  // A diamond, not a disk: it reads as "different" even without color. Slightly larger so that its area matches its hit circle.
  spitter: { style: 'diamond', shade: 0.8 },
  // The two bosses: a big spiked disk (it rushes), and a big disk with a barrel (it shoots).
  crusher: { style: 'spiked', shade: 0.6 },
  gunner: { style: 'turret', shade: 0.6 },
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
    if (look.style === 'spiked' || look.style === 'turret') { drawBoss(g, enemy, state, level, look, kind.radius); continue; }
    if (look.style === 'diamond') {
      const r = kind.radius * 1.2;
      const points = [{ x: enemy.x, y: enemy.y - r }, { x: enemy.x + r, y: enemy.y }, { x: enemy.x, y: enemy.y + r }, { x: enemy.x - r, y: enemy.y }];
      g.fillStyle(shade(level.theme.enemy, look.shade), 1).fillPoints(points, true);
      g.lineStyle(2, 0xffffff, 0.9).strokePoints(points, true);
    } else if (look.style === 'armored') {
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

/** A boss: a big disk with a thick rim. The crusher has spikes, and a pulsing ring while it warns that it is about to rush
 * and a fading trail while it rushes; the gunner has a barrel that points at the player. */
function drawBoss(g: Phaser.GameObjects.Graphics, enemy: ShooterEnemy, state: ShooterState, level: ShooterLevel, look: EnemyLook, radius: number) {
  const base = color(level.theme.enemy);
  if (enemy.bossPhase === 'charge') {
    const dx = enemy.chargeDx ?? 0;
    const dy = enemy.chargeDy ?? 0;
    for (let k = 3; k >= 1; k -= 1) g.fillStyle(base, 0.1 * (4 - k)).fillCircle(enemy.x - dx * 14 * k, enemy.y - dy * 14 * k, radius);
  }
  if (enemy.bossPhase === 'telegraph' && Math.floor(state.tick / 6) % 2 === 0) {
    g.lineStyle(4, 0xffffff, 0.9).strokeCircle(enemy.x, enemy.y, radius + 10);
  }
  if (look.style === 'spiked') {
    // twelve spikes: a triangle every 30 degrees (a table of unit vectors: no trigonometry)
    for (const [ux, uy] of SPIKES) {
      g.fillStyle(shade(level.theme.enemy, look.shade), 1).fillTriangle(
        enemy.x + ux * (radius + 9), enemy.y + uy * (radius + 9),
        enemy.x + ux * (radius - 4) - uy * 7, enemy.y + uy * (radius - 4) + ux * 7,
        enemy.x + ux * (radius - 4) + uy * 7, enemy.y + uy * (radius - 4) - ux * 7,
      );
    }
  }
  g.fillStyle(shade(level.theme.enemy, look.shade), 1).fillCircle(enemy.x, enemy.y, radius);
  g.lineStyle(5, base, 1).strokeCircle(enemy.x, enemy.y, radius - 2.5);
  if (look.style === 'turret') {
    const dx = state.player.x - enemy.x;
    const dy = state.player.y - enemy.y;
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    g.lineStyle(9, 0xffffff, 0.95).lineBetween(enemy.x, enemy.y, enemy.x + (dx / length) * (radius + 12), enemy.y + (dy / length) * (radius + 12));
    g.fillStyle(base, 1).fillCircle(enemy.x, enemy.y, radius * 0.4);
  } else {
    g.fillStyle(base, 1).fillCircle(enemy.x, enemy.y, radius * 0.35);
  }
}
/** Unit vectors every 30 degrees, for the crusher's spikes. */
const SPIKES: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0.866, 0.5], [0.5, 0.866], [0, 1], [-0.5, 0.866], [-0.866, 0.5], [-1, 0], [-0.866, -0.5], [-0.5, -0.866], [0, -1], [0.5, -0.866], [0.866, -0.5],
];

export function drawBullets(g: Phaser.GameObjects.Graphics, state: ShooterState, level: ShooterLevel) {
  g.fillStyle(color(level.theme.bullet), 1);
  for (const bullet of state.bullets) {
    if (bullet.pierceLeft === undefined) { g.fillCircle(bullet.x, bullet.y, BULLET_RADIUS); continue; }
    // a piercing bullet is a short line along its flight, so it looks different at once
    const speed = Math.sqrt(bullet.vx * bullet.vx + bullet.vy * bullet.vy) || 1;
    g.lineStyle(4, color(level.theme.bullet), 1).lineBetween(bullet.x - (bullet.vx / speed) * 18, bullet.y - (bullet.vy / speed) * 18, bullet.x, bullet.y);
  }
}

/** The base: a dark square with a lighter roof and a door on the side the player is on, a thick rim in the theme's accent, and a small
 * health bar above it. It flashes white for a moment when it is hit, and its rim flashes red when it is low. */
export function drawBase(g: Phaser.GameObjects.Graphics, state: ShooterState, level: ShooterLevel) {
  const { base, player } = state;
  if (!base) return;
  const half = BASE_SIZE / 2;
  const left = base.x - half;
  const top = base.y - half;
  const bar = baseBar(base.hp, base.maxHp);
  g.fillStyle(shade(level.theme.accent, 0.4), 1).fillRect(left, top, BASE_SIZE, BASE_SIZE);
  g.fillStyle(shade(level.theme.accent, 0.7), 1).fillRect(base.x - 18, base.y - 18, 36, 36);
  // the door, on the side the player is on
  const dx = player.x - base.x;
  const dy = player.y - base.y;
  g.fillStyle(0x060d18, 1);
  if (Math.abs(dx) >= Math.abs(dy)) g.fillRect(dx >= 0 ? base.x + half - 8 : left, base.y - 9, 8, 18);
  else g.fillRect(base.x - 9, dy >= 0 ? base.y + half - 8 : top, 18, 8);
  const flashingRed = bar.low && Math.floor(state.tick / 10) % 2 === 0;
  g.lineStyle(5, flashingRed ? 0xff4d4d : color(level.theme.accent), 1).strokeRect(left, top, BASE_SIZE, BASE_SIZE);
  if (state.tick - base.lastHitTick < 12 && Math.floor(state.tick / 3) % 2 === 0) g.fillStyle(0xffffff, 0.65).fillRect(left, top, BASE_SIZE, BASE_SIZE);
  g.fillStyle(0x060d18, 0.85).fillRect(left, top - 15, BASE_SIZE, 8);
  g.fillStyle(flashingRed ? 0xff4d4d : color(level.theme.accent), 1).fillRect(left + 1, top - 14, (BASE_SIZE - 2) * bar.share, 6);
}

/** Bullets of shooting enemies: a lighter disk with a thin white rim, so they are never mistaken for the player's. */
export function drawEnemyBullets(g: Phaser.GameObjects.Graphics, state: ShooterState, level: ShooterLevel) {
  for (const bullet of state.enemyBullets) {
    g.fillStyle(shade(level.theme.enemy, 1.35), 1).fillCircle(bullet.x, bullet.y, bullet.radius);
    g.lineStyle(1, 0xffffff, 0.9).strokeCircle(bullet.x, bullet.y, bullet.radius);
  }
}

/** Health pickups: a green disk with a white plus, blinking in the last 3 seconds before it vanishes. */
export function drawPickups(g: Phaser.GameObjects.Graphics, state: ShooterState) {
  for (const pickup of state.pickups) {
    const blinking = pickup.expiresTick - state.tick < 180 && Math.floor(state.tick / 8) % 2 === 0;
    const alpha = blinking ? 0.3 : 1;
    g.fillStyle(0x4ade80, alpha).fillCircle(pickup.x, pickup.y, 10);
    g.lineStyle(3, 0xffffff, alpha).lineBetween(pickup.x - 5, pickup.y, pickup.x + 5, pickup.y).lineBetween(pickup.x, pickup.y - 5, pickup.x, pickup.y + 5);
  }
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
  drawPickups(g, state);
  drawBase(g, state, level);
  drawEnemies(g, state, level);
  drawEnemyBullets(g, state, level);
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
  const title2 = bannerTitle(level.win, level.base !== undefined);
  const lines = bannerLines(title2); // a long goal (a base to defend) goes on two lines
  const two = lines.length > 1;
  const note = document.createElement('p');
  note.id = 'game-banner';
  note.setAttribute('role', 'status');
  note.textContent = `${title2}. ${BANNER_HINT}`;
  Object.assign(note.style, { position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: '0', overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' });
  document.getElementById('game-banner')?.remove();
  document.body.appendChild(note);
  const plate = scene.add.rectangle(480, two ? 214 : 205, 700, two ? 124 : 86, 0x060d18, 0.62).setDepth(20);
  const title = scene.add.text(480, two ? 196 : 188, lines.join('\n'), {
    fontFamily: 'system-ui', fontSize: '32px', fontStyle: 'bold', color: text, stroke: '#060d18', strokeThickness: 5, align: 'center',
  }).setOrigin(0.5).setDepth(21);
  const hint = scene.add.text(480, two ? 258 : 226, BANNER_HINT, {
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

/** The boss bar under the HUD, and the warning when the boss appears. Everything is read from the state of the game: the
 * warning's timing counts game ticks from the first tick that a boss is on the field (so a restart starts it again), the
 * bar is full at the boss's maximum and shows "CUỒNG NỘ" once it is enraged. The same words are in a visually hidden
 * `#game-boss-warning` while the warning is up (for screen readers and tests). Nothing is drawn in a level without a boss. */
export function createBossUi(scene: Phaser.Scene, level: ShooterLevel): { update(state: ShooterState): void; bounds(): string; dispose(): void } | undefined {
  if (!bossWaveOf(level)) return undefined;
  const plate = scene.add.rectangle(480, 83, 488, 20, 0x060d18, 0.72).setDepth(12).setVisible(false);
  const fill = scene.add.rectangle(240, 83, 480, 12, color(level.theme.enemy), 1).setOrigin(0, 0.5).setDepth(13).setVisible(false);
  const label = scene.add.text(246, 83, 'BOSS', { fontFamily: 'system-ui', fontSize: '12px', fontStyle: 'bold', color: '#ffffff', stroke: '#060d18', strokeThickness: 3 }).setOrigin(0, 0.5).setDepth(14).setVisible(false);
  const note = scene.add.text(714, 83, '', { fontFamily: 'system-ui', fontSize: '12px', fontStyle: 'bold', color: '#ffd166', stroke: '#060d18', strokeThickness: 3 }).setOrigin(1, 0.5).setDepth(14).setVisible(false);
  const warning = scene.add.text(480, 150, BOSS_WARNING_TEXT, { fontFamily: 'system-ui', fontSize: '38px', fontStyle: 'bold', color: '#ffffff', stroke: '#060d18', strokeThickness: 6 }).setOrigin(0.5).setDepth(22).setVisible(false);
  let note2: HTMLElement | undefined;
  let seenAt: number | undefined;
  let barUp = false;
  const hideNote = () => { note2?.remove(); note2 = undefined; };
  return {
    update(state) {
      const boss = state.enemies.find((enemy) => isBoss(enemy.type) && enemy.maxHp !== undefined);
      const visible = boss !== undefined && boss.hp > 0;
      barUp = visible;
      for (const part of [plate, fill, label]) part.setVisible(visible);
      if (boss && visible) {
        const spec = bossOf(boss.type)!;
        const bar = bossBar(boss.hp, boss.maxHp!, isEnraged(boss, spec));
        fill.setDisplaySize(Math.max(0, 480 * bar.share), 12);
        note.setText(bar.note).setVisible(bar.note !== '');
        if (seenAt === undefined) seenAt = state.tick;
      } else note.setVisible(false);
      const alpha = seenAt === undefined ? 0 : bossWarningAlpha(state.tick - seenAt);
      warning.setVisible(alpha > 0).setAlpha(alpha);
      if (alpha > 0 && !note2) {
        note2 = document.createElement('p');
        note2.id = 'game-boss-warning';
        note2.setAttribute('role', 'status');
        note2.textContent = BOSS_WARNING_TEXT;
        Object.assign(note2.style, { position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: '0', overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' });
        document.getElementById('game-boss-warning')?.remove();
        document.body.appendChild(note2);
      }
      if (alpha <= 0) hideNote();
    },
    /** The plate of the bar as drawn ("x,y,width,height"), or "" when the bar is not up. */
    bounds() { const b = plate.getBounds(); return barUp ? `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}` : ''; },
    dispose() { hideNote(); for (const part of [plate, fill, label, note, warning]) part.destroy(); },
  };
}

/** The base's bar on top of the screen, in the HUD strip at the right: "CĂN CỨ", then a bar that is full at the base's maximum and
 * flashes red when the base is low. Nothing is drawn in a level without a base. `bounds()` is the plate as drawn, for the tests. */
export function createBaseUi(scene: Phaser.Scene, level: ShooterLevel): { update(state: ShooterState): void; bounds(): string; dispose(): void } | undefined {
  if (!level.base) return undefined;
  const accent = color(level.theme.accent);
  const plate = scene.add.rectangle(BASE_BAR_PLATE.x + BASE_BAR_PLATE.width / 2, BASE_BAR_PLATE.y + BASE_BAR_PLATE.height / 2, BASE_BAR_PLATE.width, BASE_BAR_PLATE.height, 0x060d18, 0.85).setDepth(11);
  const fill = scene.add.rectangle(BASE_BAR.x, BASE_BAR.y + BASE_BAR.height / 2, BASE_BAR.width, BASE_BAR.height, accent, 1).setOrigin(0, 0.5).setDepth(12);
  const label = scene.add.text(BASE_BAR_LABEL.x, BASE_BAR_LABEL.y, 'CĂN CỨ', { fontFamily: 'system-ui', fontSize: '13px', fontStyle: 'bold', color: '#ffffff', stroke: '#060d18', strokeThickness: 3 }).setOrigin(1, 0.5).setDepth(12);
  return {
    update(state) {
      if (!state.base) return;
      const bar = baseBar(state.base.hp, state.base.maxHp);
      fill.setDisplaySize(Math.max(0, BASE_BAR.width * bar.share), BASE_BAR.height);
      fill.setFillStyle(bar.low && Math.floor(state.tick / 10) % 2 === 0 ? 0xff4d4d : accent, 1);
    },
    bounds() { const b = plate.getBounds(); return `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}`; },
    dispose() { for (const part of [plate, fill, label]) part.destroy(); },
  };
}
