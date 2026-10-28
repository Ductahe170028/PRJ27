import { z } from 'zod';

export const SelectionSchema = z.object({
  providerId: z.string().min(1).max(40).regex(/^[a-z][a-z0-9-]*$/),
  modelId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9._\/-]+$/),
}).strict();

// Settings can remember an unavailable provider before models are configured.
// API requests must still pass SelectionSchema, which requires a model ID.
export const SelectionPreferenceSchema = SelectionSchema.extend({ modelId: SelectionSchema.shape.modelId.or(z.literal('')) });
export const CapabilitySchema = z.object({
  outputMode: z.enum(['json_schema', 'json_mode']),
  structuredOutput: z.boolean(),
  genres: z.array(z.enum(['platformer', 'top-down'])).min(1).max(2),
}).strict();
export const ModelInfoSchema = z.object({
  id: SelectionSchema.shape.modelId,
  name: z.string().max(120),
  capabilities: CapabilitySchema,
}).strict();
export const ProviderInfoSchema = z.object({
  id: SelectionSchema.shape.providerId, name: z.string().max(80), available: z.boolean(),
  reason: z.enum(['missing_key', 'models_unconfigured', 'free_tier_unconfirmed', 'invalid_model']).nullable(),
  models: z.array(ModelInfoSchema).max(10),
}).strict();
export const ProvidersResponseSchema = z.object({ providers: z.array(ProviderInfoSchema).max(20) }).strict();
export const TestConnectionResponseSchema = z.object({
  status: z.literal('connected'), providerId: z.string(), modelId: z.string(),
  message: z.string().max(300),
}).strict();
export type ProviderSelection = z.infer<typeof SelectionSchema>;
export type ModelInfo = z.infer<typeof ModelInfoSchema>;
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;
