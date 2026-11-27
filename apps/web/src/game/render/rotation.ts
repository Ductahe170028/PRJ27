// Turning without jumps: a sprite turns toward where it goes, a little each frame, the short way round.
const TWO_PI = Math.PI * 2;

/** An angle brought into (-PI, PI]. */
export function wrapAngle(angle: number): number {
  let a = angle % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  else if (a <= -Math.PI) a += TWO_PI;
  return a;
}

/** The signed shortest turn from `from` to `to`, in (-PI, PI]. */
export const angleDelta = (from: number, to: number) => wrapAngle(to - from);

/** `current` turned toward `target` by at most `maxStep` radians (the short way): never a 180 degree snap. */
export function turnToward(current: number, target: number, maxStep: number): number {
  const delta = angleDelta(current, target);
  if (Math.abs(delta) <= maxStep) return wrapAngle(target);
  return wrapAngle(current + Math.sign(delta) * maxStep);
}

/** The angle after `dtMs` of turning at `radPerSecond`. */
export const turnFor = (current: number, target: number, dtMs: number, radPerSecond: number) => turnToward(current, target, (radPerSecond * dtMs) / 1000);
