// The writing and the bars of the shooter: the HUD strip, the goal banner, the boss bar and warning, the base's bar. Nothing here has
// a rule: it reads a ShooterState (or a level) and paints it, plus the visually hidden elements the tests read (#game-banner,
// #game-boss-warning). ShooterScene owns the loop; the sentences are in lib/shooter-text.ts; the world is drawn in shooter-draw.ts.
import Phaser from 'phaser';
import { EQUIP_MS, bossOf, bossWaveOf, isBoss, isEnraged, msToTicks, startingSlot, type Look, type ShooterLevel, type ShooterState } from '@game-creator/contracts';
import { packKey, type LoadedArt } from './art/loader';
import { prefersReducedMotion } from './render/motion';
import { registerPack } from './render/world';
import {
  ARSENAL_HINT, BANNER_HINT, BASE_BAR, BASE_BAR_LABEL, BASE_BAR_PLATE, BOSS_WARNING_TEXT, bannerAlpha, bannerLines, bannerTextColor, bannerTitle, baseBar, bossBar, bossWarningAlpha, waitShare, weaponBarLayout, WEAPON_CELL,
} from '../lib/shooter-text';
import { CSS, PALETTE, color } from './palette';

/** The bar on top: title, the HUD line (updated by the scene) and the game's name. */
export function createHud(scene: Phaser.Scene, level: ShooterLevel): Phaser.GameObjects.Text {
  scene.add.rectangle(480, 35, 960, 70, PALETTE.ink, 0.8).setDepth(8);
  scene.add.text(22, 12, level.title, { fontFamily: 'system-ui', fontSize: '20px', color: CSS.white }).setDepth(9);
  const hud = scene.add.text(22, 43, '', { fontFamily: 'system-ui', fontSize: '13px', color: CSS.text }).setDepth(10);
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
  // a level with an arsenal has a third line: how to switch weapons (the other levels keep exactly the old sentence)
  const extra = level.arsenal ? ARSENAL_HINT : undefined;
  note.textContent = `${title2}. ${BANNER_HINT}${extra ? `. ${extra}` : ''}`;
  Object.assign(note.style, { position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: '0', overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' });
  document.getElementById('game-banner')?.remove();
  document.body.appendChild(note);
  const plate = scene.add.rectangle(480, (two ? 214 : 205) + (extra ? 12 : 0), 700, (two ? 124 : 86) + (extra ? 24 : 0), PALETTE.ink, 0.62).setDepth(20);
  const title = scene.add.text(480, two ? 196 : 188, lines.join('\n'), {
    fontFamily: 'system-ui', fontSize: '32px', fontStyle: 'bold', color: text, stroke: CSS.ink, strokeThickness: 5, align: 'center',
  }).setOrigin(0.5).setDepth(21);
  const hint = scene.add.text(480, two ? 258 : 226, BANNER_HINT, {
    fontFamily: 'system-ui', fontSize: '16px', color: CSS.white, stroke: CSS.ink, strokeThickness: 4,
  }).setOrigin(0.5).setDepth(21);
  const hint2 = extra === undefined ? undefined : scene.add.text(480, (two ? 258 : 226) + 26, extra, {
    fontFamily: 'system-ui', fontSize: '16px', fontStyle: 'bold', color: CSS.gold, stroke: CSS.ink, strokeThickness: 4,
  }).setOrigin(0.5).setDepth(21);
  const parts = hint2 ? [plate, title, hint, hint2] : [plate, title, hint];
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
      hint2?.setAlpha(alpha);
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
  const plate = scene.add.rectangle(480, 83, 488, 20, PALETTE.ink, 0.72).setDepth(12).setVisible(false);
  const fill = scene.add.rectangle(240, 83, 480, 12, color(level.theme.enemy), 1).setOrigin(0, 0.5).setDepth(13).setVisible(false);
  const label = scene.add.text(246, 83, 'BOSS', { fontFamily: 'system-ui', fontSize: '12px', fontStyle: 'bold', color: CSS.white, stroke: CSS.ink, strokeThickness: 3 }).setOrigin(0, 0.5).setDepth(14).setVisible(false);
  const note = scene.add.text(714, 83, '', { fontFamily: 'system-ui', fontSize: '12px', fontStyle: 'bold', color: CSS.gold, stroke: CSS.ink, strokeThickness: 3 }).setOrigin(1, 0.5).setDepth(14).setVisible(false);
  const warning = scene.add.text(480, 150, BOSS_WARNING_TEXT, { fontFamily: 'system-ui', fontSize: '38px', fontStyle: 'bold', color: CSS.white, stroke: CSS.ink, strokeThickness: 6 }).setOrigin(0.5).setDepth(22).setVisible(false);
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
  const plate = scene.add.rectangle(BASE_BAR_PLATE.x + BASE_BAR_PLATE.width / 2, BASE_BAR_PLATE.y + BASE_BAR_PLATE.height / 2, BASE_BAR_PLATE.width, BASE_BAR_PLATE.height, PALETTE.ink, 0.85).setDepth(11);
  const fill = scene.add.rectangle(BASE_BAR.x, BASE_BAR.y + BASE_BAR.height / 2, BASE_BAR.width, BASE_BAR.height, accent, 1).setOrigin(0, 0.5).setDepth(12);
  const label = scene.add.text(BASE_BAR_LABEL.x, BASE_BAR_LABEL.y, 'CĂN CỨ', { fontFamily: 'system-ui', fontSize: '13px', fontStyle: 'bold', color: CSS.white, stroke: CSS.ink, strokeThickness: 3 }).setOrigin(1, 0.5).setDepth(12);
  return {
    update(state) {
      if (!state.base) return;
      const bar = baseBar(state.base.hp, state.base.maxHp);
      fill.setDisplaySize(Math.max(0, BASE_BAR.width * bar.share), BASE_BAR.height);
      fill.setFillStyle(bar.low && Math.floor(state.tick / 10) % 2 === 0 ? PALETTE.danger : accent, 1);
    },
    bounds() { const b = plate.getBounds(); return `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}`; },
    dispose() { for (const part of [plate, fill, label]) part.destroy(); },
  };
}

/** The bar of weapons along the bottom of the field, only in a level with an arsenal: one cell of 40 x 40 per weapon, with the number of its
 * key and a small picture of the gun (the `icon` frame of its weapon pack), the cell in hand framed in white, and a darkening that sweeps
 * the cells while the player waits (a switch, or the shared shot clock). It is drawn over the world and under nothing else; it takes no
 * mouse input. `bounds()` is the plate as drawn, for the tests. A switch makes the cell of the new weapon flash (not for a player who asked
 * for less motion). */
export function createWeaponBar(
  scene: Phaser.Scene, level: ShooterLevel, art: LoadedArt, look: Look,
): { update(state: ShooterState, deltaMs: number): void; bounds(): string; dispose(): void } | undefined {
  const arsenal = level.arsenal;
  if (!arsenal) return undefined;
  const layout = weaponBarLayout(arsenal.length);
  const start = startingSlot(level);
  const reduced = prefersReducedMotion();
  const parts: Phaser.GameObjects.GameObject[] = [];
  const plate = scene.add.rectangle(layout.plate.x + layout.plate.width / 2, layout.plate.y + layout.plate.height / 2, layout.plate.width, layout.plate.height, PALETTE.ink, 0.55).setDepth(11);
  parts.push(plate);
  const cooldownTicks = arsenal.map((entry) => msToTicks(entry.weapon.cooldownMs));
  const cells = layout.cells.map((cell, i) => {
    const entry = arsenal[i]!;
    const box = scene.add.rectangle(cell.x + WEAPON_CELL / 2, cell.y + WEAPON_CELL / 2, WEAPON_CELL, WEAPON_CELL, PALETTE.ink, 0.7).setDepth(12).setStrokeStyle(2, PALETTE.white, 0.22);
    // the gun's picture: the icon frame of its pack (the starting weapon uses the level's look), or the first frame of its idle
    const pack = art.packs.get(packKey('weapon', i === start ? look.weapon : entry.id));
    let icon: Phaser.GameObjects.Image | undefined;
    if (pack) {
      registerPack(scene.textures, pack);
      const frame = pack.manifest.frame ?? { w: 40, h: 24 };
      const index = pack.manifest.icon ?? pack.manifest.animations?.idle?.frames[0] ?? 0;
      icon = scene.add.image(cell.x + WEAPON_CELL / 2, cell.y + WEAPON_CELL / 2 + 3, `pack:${packKey('weapon', pack.id)}`, String(index)).setDepth(13)
        .setScale(Math.min(32 / frame.w, 24 / frame.h));
    }
    const number = scene.add.text(cell.x + 4, cell.y + 2, cell.key, { fontFamily: 'system-ui', fontSize: '11px', fontStyle: 'bold', color: CSS.white, stroke: CSS.ink, strokeThickness: 3 }).setDepth(14);
    const wait = scene.add.rectangle(cell.x, cell.y, WEAPON_CELL, 0, PALETTE.ink, 0.62).setOrigin(0, 0).setDepth(15).setVisible(false);
    const flash = scene.add.rectangle(cell.x + WEAPON_CELL / 2, cell.y + WEAPON_CELL / 2, WEAPON_CELL, WEAPON_CELL, PALETTE.white, 0).setDepth(16);
    parts.push(box, number, wait, flash, ...(icon ? [icon] : []));
    return { box, wait, flash, icon };
  });
  let lastSlot: number | undefined;
  let flashMs = EQUIP_MS;
  let flashSlot = -1;
  return {
    update(state, deltaMs) {
      const slot = state.weaponSlot;
      if (slot === undefined) return;
      if (lastSlot !== undefined && slot !== lastSlot) { flashMs = 0; flashSlot = slot; }
      lastSlot = slot;
      flashMs += deltaMs;
      const share = waitShare(state.tick, state.player.nextShotTick, state.equipUntilTick ?? 0, cooldownTicks[slot] ?? 1, msToTicks(EQUIP_MS));
      cells.forEach((cell, i) => {
        const selected = i === slot;
        cell.box.setStrokeStyle(selected ? 3 : 2, PALETTE.white, selected ? 1 : 0.22).setFillStyle(PALETTE.ink, selected ? 0.9 : 0.7);
        cell.icon?.setAlpha(selected ? 1 : 0.7);
        const sweeping = share > 0.04;
        cell.wait.setVisible(sweeping).setSize(WEAPON_CELL, WEAPON_CELL * share);
        const glow = !reduced && i === flashSlot && flashMs < EQUIP_MS ? 0.55 * (1 - flashMs / EQUIP_MS) : 0;
        cell.flash.setFillStyle(PALETTE.white, glow);
      });
    },
    bounds() { const b = plate.getBounds(); return `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}`; },
    dispose() { for (const part of parts) part.destroy(); },
  };
}
