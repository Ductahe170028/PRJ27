import { GenerateGameRequestSchema, PROMPT_MAX_LENGTH } from '@game-creator/contracts';

/** Live warning for a draft that is longer than the backend accepts. The draft itself is never sliced. */
export function promptLimitWarning(prompt: string): string {
  if (prompt.length <= PROMPT_MAX_LENGTH) return '';
  const actual = prompt.length.toLocaleString('vi-VN');
  const limit = PROMPT_MAX_LENGTH.toLocaleString('vi-VN');
  return `Mô tả dài ${actual} ký tự, vượt quá ${limit}. Hãy rút ngắn trước khi tạo game.`;
}

/**
 * The prompt to POST when the draft is inside the contract.
 * Returns the textarea text unchanged — not the trimmed schema copy and never a 2,000-character slice.
 */
export function promptToSend(prompt: string): string | null {
  if (promptLimitWarning(prompt)) return null;
  if (!GenerateGameRequestSchema.safeParse({ prompt }).success) return null;
  return prompt;
}
