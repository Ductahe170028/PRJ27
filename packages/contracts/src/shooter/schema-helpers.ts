// The two schema pieces that the level (here) and the AI's brief (apps/api) both use, written once.
import { z } from 'zod';

/** A whole number from `min` to `max`, both included. */
export const intBetween = (min: number, max: number) => z.number().int().min(min).max(max);

/** A title or label: letters, marks, numbers, dashes and simple title punctuation, 1 to `max` characters. No markup, URLs or code. */
export const labelOf = (max: number) => z.string().min(1).max(max).regex(/^[\p{L}\p{M}\p{N}\p{Pd} .,!?"'():]+$/u);
