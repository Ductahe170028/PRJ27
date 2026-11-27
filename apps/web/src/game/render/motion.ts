// Whether the player asked their system for less motion. When they did, the game keeps no screen shake, no hit flashes and no
// drifting specks in the air (the game itself plays the same).
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
