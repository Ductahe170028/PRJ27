import type { ProbeBirth, ProbeEntity } from './gameplay-probe.js';
import type { ProjectileRequirement } from './gameplay-requirements.js';

export function firingDirection(birth: ProbeBirth, requirement: ProjectileRequirement, pointer: { x: number; y: number }) {
  const player = birth.player;
  if (!player) return undefined;
  const dx = requirement.pointer ? pointer.x - player.x : birth.x - player.x;
  const dy = requirement.pointer ? pointer.y - player.y : birth.y - player.y;
  const length = Math.hypot(dx, dy);
  return requirement.direction ?? (length > 1 ? { x: dx / length, y: dy / length } : undefined);
}

export function checkProjectileFlight(birth: ProbeBirth, afterRelease: ProbeEntity | undefined, direction: { x: number; y: number } | undefined, releasedAt: ProbeEntity = birth): string[] {
  const errors: string[] = [];
  if (!direction || !birth.player) return ['Projectile: cannot determine a forward launch direction; spawn at the front of the player, not its center.'];
  const p = birth.player;
  const launch = (birth.x - p.x) * direction.x + (birth.y - p.y) * direction.y;
  const edge = (Math.abs(direction.x) * (p.width + birth.width) + Math.abs(direction.y) * (p.height + birth.height)) / 2;
  if (launch < edge - 3) errors.push('Projectile: spawn at the front edge of the player, outside its body.');
  if (!afterRelease || (afterRelease.x - releasedAt.x) * direction.x + (afterRelease.y - releasedAt.y) * direction.y < 3) {
    errors.push('Projectile: no continuous forward flight after action release. vx/vy alone do not move entities; update x/y with velocity * dt every frame.');
  }
  return errors;
}
