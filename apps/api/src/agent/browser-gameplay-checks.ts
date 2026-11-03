import type { Frame, Page } from 'playwright';
import type { GamePlan } from '@game-creator/contracts';
import type { GameplaySnapshot, ProbeBirth, ProbeEntity } from './gameplay-probe.js';
import { projectileRequirement } from './gameplay-requirements.js';
import { checkProjectileFlight, firingDirection } from './projectile-checks.js';

interface Probe { read(): GameplaySnapshot; position(values: Array<{ id: number; x: number; y: number }>): void }
declare global { interface Window { __agentGameplayProbe: Probe } }
const snapshot = (frame: Frame) => frame.evaluate(() => window.__agentGameplayProbe.read());
const position = (frame: Frame, values: Array<{ id: number; x: number; y: number }>) => frame.evaluate((values) => window.__agentGameplayProbe.position(values), values);

/** Real keyboard/pointer input and real update/collision code in Chromium.
 * Controlled arrangements isolate collision and edge cleanup from random enemy waves.
 * No projectile kind/color, aircraft coordinates, or generated source patterns are assumed.
 */
export async function runGameplayChecks(page: Page, plan: GamePlan, request: string, add: (message: string) => void): Promise<void> {
  const requirement = projectileRequirement(plan, request);
  if (!requirement) return;
  if (plan.action === 'none') { add('Projectile: shooting was requested but the plan has no firing input.'); return; }
  const frame = page.frames().find((candidate) => candidate.parentFrame() === page.mainFrame());
  if (!frame) { add('Projectile: isolated gameplay frame is unavailable.'); return; }
  const canvas = page.frameLocator('iframe').locator('canvas');
  await canvas.click({ position: { x: 480, y: 300 } });
  await page.keyboard.press('r');
  await page.waitForTimeout(80);
  const initial = await snapshot(frame);
  const player = initial.entities.find((entity) => entity.id === initial.playerId);
  if (!player) { add('Projectile: setPlayer must identify the firing player.'); return; }
  const pointer = { x: Math.min(930, player.x + 300), y: player.y };
  const fire = async (): Promise<ProbeBirth | undefined> => {
    const before = await snapshot(frame);
    const ids = new Set(before.births.map((entity) => entity.id));
    if (plan.action === 'space') await page.keyboard.down('Space');
    else {
      const box = await canvas.boundingBox();
      if (!box) return;
      await page.mouse.move(box.x + pointer.x * box.width / 960, box.y + pointer.y * box.height / 540);
      await page.mouse.down();
    }
    try {
      await frame.waitForFunction((oldIds) => {
        const state = window.__agentGameplayProbe.read();
        return state.births.some((entity) => !oldIds.includes(entity.id) && entity.player
          && Math.hypot(entity.x - entity.player.x, entity.y - entity.player.y) <= 140);
      }, [...ids], { timeout: 1500, polling: 20 });
    } catch { return undefined; }
    finally {
      if (plan.action === 'space') await page.keyboard.up('Space'); else await page.mouse.up();
    }
    return (await snapshot(frame)).births.find((entity) => !ids.has(entity.id) && entity.player
      && Math.hypot(entity.x - entity.player.x, entity.y - entity.player.y) <= 140);
  };
  const birth = await fire();
  if (!birth) { add('Projectile: firing input did not launch an entity near the player.'); return; }
  const direction = firingDirection(birth, requirement, pointer);
  const releasedAt = (await snapshot(frame)).entities.find((entity) => entity.id === birth.id);
  // Make an empty firing lane without moving the projectile: the natural trajectory remains observable.
  const lane = (await snapshot(frame)).entities.filter((entity) => entity.id !== initial.playerId && entity.id !== birth.id)
    .map((entity) => ({ id: entity.id, x: direction?.x ? 480 : 930, y: direction?.x ? 70 : 270 }));
  await position(frame, lane);
  await page.waitForTimeout(260);
  const flight = await snapshot(frame);
  const projectile = flight.entities.find((entity) => entity.id === birth.id);
  const flightErrors = checkProjectileFlight(birth, projectile, direction, releasedAt);
  flightErrors.forEach(add);
  if (flightErrors.length || !projectile || !direction) return;
  await page.waitForTimeout(160);
  const continued = (await snapshot(frame)).entities.find((entity) => entity.id === birth.id);
  if (!continued || (continued.x - projectile.x) * direction.x + (continued.y - projectile.y) * direction.y < 1) {
    add('Projectile: flight stopped after release; integrate velocity on every update, not only during a firing animation.'); return;
  }

  // The same projectile is placed just beyond its exit edge. Its own update must remove it.
  const edge = { id: projectile.id, x: direction.x > 0 ? 1024 + projectile.width / 2 : direction.x < 0 ? -64 - projectile.width / 2 : projectile.x,
    y: direction.y > 0 ? 604 + projectile.height / 2 : direction.y < 0 ? -64 - projectile.height / 2 : projectile.y };
  await position(frame, [...lane, edge]);
  await page.waitForTimeout(100);
  if ((await snapshot(frame)).entities.some((entity) => entity.id === projectile.id)) add('Projectile: remove offscreen projectiles in update; do not leave them alive outside the playfield.');
  await position(frame, []);

  // Pick a real target created by this game, not a test-only enemy or an assumed kind name.
  let target: ProbeEntity | undefined;
  const projectileIds = new Set((await snapshot(frame)).births.filter((entity) => entity.player
    && Math.hypot(entity.x - entity.player.x, entity.y - entity.player.y) <= 140).map((entity) => entity.id));
  try {
    await frame.waitForFunction(({ playerId, projectileIds }) => window.__agentGameplayProbe.read().entities
      .some((entity) => entity.id !== playerId && !projectileIds.includes(entity.id) && entity.hp > 0),
    { playerId: initial.playerId, projectileIds: [...projectileIds] }, { timeout: 6500, polling: 50 });
    target = (await snapshot(frame)).entities.find((entity) => entity.id !== initial.playerId && !projectileIds.has(entity.id) && entity.hp > 0);
  } catch { /* A requested damage interaction must have an observable target. */ }
  if (!target) { add('Projectile: no damageable target appeared during the bounded gameplay scenario.'); return; }
  const second = await fire();
  if (!second) { add('Projectile: firing again after release/cooldown did not launch a projectile.'); return; }
  const current = (await snapshot(frame)).entities.find((entity) => entity.id === second.id);
  if (!current) { add('Projectile: a new shot disappeared before its flight/collision could be observed.'); return; }
  const gap = (Math.abs(direction.x) * (current.width + target.width) + Math.abs(direction.y) * (current.height + target.height)) / 2 + 18;
  const start = await snapshot(frame);
  // Fix only the target position ahead of the shot, retaining its original hp and collision code.
  await position(frame, [{ id: target.id, x: current.x + direction.x * gap, y: current.y + direction.y * gap }]);
  try {
    await frame.waitForFunction(({ bullet, target, time }) => window.__agentGameplayProbe.read().contacts
      .some((hit) => hit.time > time && ((hit.a === bullet && hit.b === target) || (hit.a === target && hit.b === bullet))),
    { bullet: current.id, target: target.id, time: start.time }, { timeout: 1600, polling: 20 });
    const after = await snapshot(frame);
    const survivor = after.entities.find((entity) => entity.id === target!.id);
    if (survivor && survivor.hp >= target.hp) add('Projectile: contact did not damage the target. Decrease hp and remove defeated targets.');
  } catch { add('Projectile: forward flight did not reach/detect a target arranged in its firing path.'); }
  finally { await position(frame, []); }
}
