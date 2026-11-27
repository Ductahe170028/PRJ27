// The `look` of a level: the ids of the art packs it is drawn with. Data only: the simulation never reads it and its hash never
// contains it (a level without one is valid and is drawn with the defaults). The contracts do not list the ids, so that a new
// art pack never changes this package (the API's look.ts and the packs in apps/web are what list them).
import { z } from 'zod';

/** The id of an art pack: also the name of its folder under public/art/<kind>/. */
export const ArtIdSchema = z.string().regex(/^[a-z0-9-]{1,30}$/);

export const LookSchema = z.object({
  biome: ArtIdSchema, hero: ArtIdSchema, family: ArtIdSchema, base: ArtIdSchema, weapon: ArtIdSchema,
}).strict();
export type Look = z.infer<typeof LookSchema>;
