// A small seeded generator (mulberry32) for the compiler: the same seed always
// gives the same numbers, on any machine. No global randomness anywhere.

export type Rng = () => number;

/** Numbers in [0, 1). */
export function makeRng(seed: number): Rng {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An independent stream for one purpose (`salt`), so adding a draw to the map
 * never shifts the waves. */
export function deriveRng(seed: number, salt: number): Rng {
  return makeRng(Math.imul(seed ^ salt, 0x9e3779b1) >>> 0);
}

/** Whole number in [min, max], both included. */
export const randomInt = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
