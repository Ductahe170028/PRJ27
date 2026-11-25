// What the AI writes: meaning only. No coordinate, size or physics number ever
// comes from the model; the compiler decides all of that.
import { z } from '@game-creator/contracts';

const integer = (min: number, max: number) => z.number().int().min(min).max(max);
// Same rule as the labels of GameSpec v1 and of ShooterLevel: letters, marks,
// numbers, dashes and simple title punctuation. No markup, URLs or code.
const label = (max: number) => z.string().min(1).max(max).regex(/^[\p{L}\p{M}\p{N}\p{Pd} .,!?"'():]+$/u);

export const SHOOTER_THEMES = ['zombie-city', 'alien-lab', 'dark-forest', 'desert-ruins', 'ice-base', 'neon-arena', 'hospital', 'military-base'] as const;
export const SHOOTER_MAPS = ['open-arena', 'pillars', 'cross-corridors', 'rooms', 'ring'] as const;
export const BRIEF_ENEMY_TYPES = ['runner', 'brute', 'swarmer', 'spitter'] as const;
export const PLAYER_HEALTHS = ['fragile', 'normal', 'sturdy'] as const;
export const WEAPONS = ['pistol', 'rapid', 'heavy', 'shotgun', 'piercing'] as const;
/** Whether defeated enemies may drop health: none (default), some or many. */
export const HEALTH_DROPS = ['none', 'some', 'many'] as const;
export const MAX_BRIEF_ENEMIES = 4;
/** The final boss of the level: none (default), a huge melee boss (crusher) or a shooting one (gunner). */
export const BOSSES = ['none', 'crusher', 'gunner'] as const;

export const TITLE_MAX = 40;
export const UNSUPPORTED_MAX_ITEMS = 5;
export const UNSUPPORTED_MAX_CHARS = 80;

export const ShooterBriefSchema = z.object({
  version: z.literal('brief-1'),
  title: label(TITLE_MAX),
  theme: z.enum(SHOOTER_THEMES),
  map: z.enum(SHOOTER_MAPS),
  enemies: z.array(z.object({ type: z.enum(BRIEF_ENEMY_TYPES), share: integer(1, 10) }).strict()).min(1).max(MAX_BRIEF_ENEMIES),
  intensity: integer(1, 5),
  playerHealth: z.enum(PLAYER_HEALTHS),
  weapon: z.enum(WEAPONS),
  healthDrops: z.enum(HEALTH_DROPS),
  boss: z.enum(BOSSES),
  goal: z.discriminatedUnion('type', [
    z.object({ type: z.literal('survive'), seconds: integer(20, 180) }).strict(),
    z.object({ type: z.literal('kill'), count: integer(10, 200) }).strict(),
  ]),
  unsupported: z.array(z.string().min(1).max(UNSUPPORTED_MAX_CHARS)).max(UNSUPPORTED_MAX_ITEMS),
}).strict().superRefine((brief, ctx) => {
  const seen = new Set<string>();
  brief.enemies.forEach((enemy, index) => {
    if (seen.has(enemy.type)) ctx.addIssue({ code: 'custom', path: ['enemies', index, 'type'], message: 'Loại quái bị lặp.' });
    seen.add(enemy.type);
  });
});

export type ShooterBrief = z.infer<typeof ShooterBriefSchema>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** A finite number rounded and held inside [min, max]; anything else is left for the schema to reject. */
const clampInt = (value: unknown, min: number, max: number): unknown =>
  (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : value);
/** At most `max` characters (whole characters, never half of a surrogate pair), trimmed. */
const cut = (text: string, max: number) => Array.from(text.trim()).slice(0, max).join('').trim();

/** Runs BEFORE the schema. Numbers are held inside their range and long text is
 * cut, because the provider cannot enforce min/max for us (the policy of
 * docs/DIRECTION.md: clamp, do not reject). It never guesses an enum value and
 * never drops an unknown field: those still fail the strict schema. */
export function normalizeBrief(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const brief: Record<string, unknown> = { ...raw };
  if (typeof brief.title === 'string') brief.title = cut(brief.title, TITLE_MAX);
  brief.intensity = clampInt(brief.intensity, 1, 5);
  // Missing altogether means the user asked for no health drops. This is the ONE value the engine fills in;
  // a value that is present but wrong ("lots", null) is left for the schema to reject, like any other enum.
  if (brief.healthDrops === undefined) brief.healthDrops = 'none';
  // Likewise a missing boss means the user asked for none.
  if (brief.boss === undefined) brief.boss = 'none';

  if (Array.isArray(brief.enemies)) {
    const merged: unknown[] = [];
    const byType = new Map<string, Record<string, unknown>>();
    for (const item of brief.enemies) {
      if (!isRecord(item)) { merged.push(item); continue; }
      const entry: Record<string, unknown> = { ...item, share: clampInt(item.share, 1, 10) };
      const known = typeof entry.type === 'string' ? byType.get(entry.type) : undefined;
      if (known && typeof known.share === 'number' && typeof entry.share === 'number') {
        known.share = Math.min(10, known.share + entry.share); // the same type twice: one entry, shares added
        continue;
      }
      if (typeof entry.type === 'string') byType.set(entry.type, entry);
      merged.push(entry);
    }
    brief.enemies = merged.slice(0, MAX_BRIEF_ENEMIES);
  }

  if (isRecord(brief.goal)) {
    const goal: Record<string, unknown> = { ...brief.goal };
    if ('seconds' in goal) goal.seconds = clampInt(goal.seconds, 20, 180);
    if ('count' in goal) goal.count = clampInt(goal.count, 10, 200);
    brief.goal = goal;
  }

  if (Array.isArray(brief.unsupported)) {
    brief.unsupported = brief.unsupported
      .map((item) => (typeof item === 'string' ? cut(item, UNSUPPORTED_MAX_CHARS) : item))
      .filter((item) => item !== '')
      .slice(0, UNSUPPORTED_MAX_ITEMS);
  }
  return brief;
}
