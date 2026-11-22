import { z } from 'zod';
import { GameSpecSchema } from './game-spec.js';
import { CapabilitySchema, SelectionSchema } from './ai.js';
import { ShooterLevelSchema } from './shooter/level.js';
export * from './game-spec.js';
export * from './ai.js';
export * from './code-agent.js';
export * from './shooter/index.js';
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

const PlatformSchema = z.object({
  x: z.number().finite().min(0).max(960),
  y: z.number().finite().min(0).max(540),
  width: z.number().finite().min(20).max(960),
  height: z.number().finite().min(10).max(80),
}).strict();

// Only declarative data crosses the API/iframe boundary. No source code or URLs.
export const GameDefinitionSchema = z.object({
  template: z.literal('platformer-v1'),
  engine: z.literal('phaser'),
  engineMajor: z.literal(3),
  width: z.literal(960),
  height: z.literal(540),
  physics: z.object({
    gravity: z.number().finite().min(200).max(2_000),
    moveSpeed: z.number().finite().min(50).max(500),
    jumpSpeed: z.number().finite().min(100).max(800),
  }).strict(),
  spawn: z.object({
    x: z.number().finite().min(20).max(940),
    y: z.number().finite().min(20).max(480),
  }).strict(),
  platforms: z.array(PlatformSchema).min(1).max(30),
}).strict();

export const DemoGameProjectSchema = z.object({
  id: z.string().uuid(),
  title: z.literal('Moonlight Run'),
  prompt: GenerateGameRequestSchema.shape.prompt,
  provider: z.literal('demo'),
  createdAt: z.string().datetime(),
  game: GameDefinitionSchema,
}).strict();

export const AIGameProjectSchema = z.object({
  id: z.string().uuid(), title: z.string().min(1).max(80),
  prompt: GenerateGameRequestSchema.shape.prompt,
  provider: SelectionSchema.shape.providerId, modelId: SelectionSchema.shape.modelId,
  capabilities: CapabilitySchema, createdAt: z.string().datetime(), game: GameSpecSchema,
}).strict();
export const GameProjectSchema = z.union([DemoGameProjectSchema, AIGameProjectSchema]);

export const GenerateGameResponseSchema = z.object({ data: GameProjectSchema }).strict();

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
export const GameSpecIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
}).strict();

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryAfterSeconds: z.number().int().positive().optional(),
    // Placement and repair failures already publish path strings. Schema
    // failures publish path, code and message. Both shapes stay readable.
    issues: z.array(z.union([z.string(), GameSpecIssueSchema])).optional(),
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
  game: z.union([GameDefinitionSchema, GameSpecSchema, ShooterLevelSchema]),
}).strict();

export type GenerateGameRequest = z.infer<typeof GenerateGameRequestSchema>;
export type GameSpecIssue = z.infer<typeof GameSpecIssueSchema>;
export type GameDefinition = z.infer<typeof GameDefinitionSchema>;
export type GameProject = z.infer<typeof GameProjectSchema>;
export type ShooterProject = z.infer<typeof ShooterProjectSchema>;
export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;
export type RuntimeInit = z.infer<typeof RuntimeInitSchema>;
/** Anything the runtime iframe can play. */
export type RuntimeGame = RuntimeInit['game'];
