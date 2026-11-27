import { z } from 'zod';
import { SelectionSchema } from './ai.js';
import { ArtListSchema } from './art.js';
import { ShooterLevelSchema } from './shooter/level.js';
export * from './ai.js';
export * from './shooter/index.js';
export * from './art.js';
// The one zod of the workspace, for packages that build schemas of their own (the API's shooter brief).
export { z } from 'zod';

export const PROMPT_MAX_LENGTH = 2_000;

export const GenerateGameRequestSchema = z.object({
  prompt: z.string().trim().min(1, 'Hãy nhập mô tả game.').max(
    PROMPT_MAX_LENGTH,
    `Mô tả không được vượt quá ${PROMPT_MAX_LENGTH} ký tự.`,
  ),
  providerId: SelectionSchema.shape.providerId.optional(),
  modelId: SelectionSchema.shape.modelId.optional(),
}).strict();

/** A generated shooter: the level, plus what the engine could not do or changed
 * (`notices`), shown to the user. */
export const ShooterProjectSchema = z.object({
  id: z.string().uuid(), title: z.string().min(1).max(80),
  prompt: GenerateGameRequestSchema.shape.prompt,
  provider: SelectionSchema.shape.providerId, modelId: SelectionSchema.shape.modelId,
  createdAt: z.string().datetime(),
  level: ShooterLevelSchema,
  notices: z.array(z.string().min(1).max(160)).max(8),
}).strict();
export const GenerateShooterResponseSchema = z.object({ data: ShooterProjectSchema }).strict();
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('ai-game-creator-api'),
  mode: z.literal('multi-provider'),
}).strict();
/** One rejected field of the model's answer: its path, the rule that failed and a fixed sentence. */
export const ErrorIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
}).strict();

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryAfterSeconds: z.number().int().positive().optional(),
    // A failure of the brief publishes path, code and message; other failures publish path strings. Both shapes stay readable.
    issues: z.array(z.union([z.string(), ErrorIssueSchema])).optional(),
  }),
});

export const RuntimeEventSchema = z.object({
  channel: z.literal('game-creator'),
  sessionId: z.string().uuid(),
  type: z.enum(['runtime:ready', 'runtime:started', 'runtime:error']),
}).strict();

export const RuntimeInitSchema = z.object({
  channel: z.literal('game-creator'),
  sessionId: z.string().uuid(),
  type: z.literal('runtime:init'),
  game: ShooterLevelSchema,
  /** The art packs the page fetched for this level (at most 12). Absent = the game draws everything with its own code. */
  art: ArtListSchema.optional(),
  /** How many packs the page wanted as PNG but could not fetch (they are drawn by code); it is only shown on the hidden HUD. */
  artFallbacks: z.number().int().min(0).max(12).optional(),
}).strict();
/** The same message with the art list left unchecked: the game iframe reads this one, then checks the art on its own, pack by pack,
 * so that a bad pack never stops a game from starting. */
export const RuntimeInitLooseSchema = RuntimeInitSchema.extend({ art: z.unknown().optional() });

export type GenerateGameRequest = z.infer<typeof GenerateGameRequestSchema>;
export type ErrorIssue = z.infer<typeof ErrorIssueSchema>;
export type ShooterProject = z.infer<typeof ShooterProjectSchema>;
export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;
export type RuntimeInit = z.infer<typeof RuntimeInitSchema>;
/** What the runtime iframe plays: a shooter level. */
export type RuntimeGame = RuntimeInit['game'];
