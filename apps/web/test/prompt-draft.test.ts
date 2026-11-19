import { describe, expect, it } from 'vitest';
import { PROMPT_MAX_LENGTH } from '@game-creator/contracts';
import { promptLimitWarning, promptToSend } from '../src/lib/prompt-draft';

describe('standard prompt draft', () => {
  it('keeps a 2496-character paste intact and blocks generate', () => {
    const pasted = 'A'.repeat(2496);
    expect(pasted).toHaveLength(2496);
    expect(promptToSend(pasted)).toBeNull();
    const warning = promptLimitWarning(pasted);
    expect(warning).toContain(pasted.length.toLocaleString('vi-VN'));
    expect(warning).toContain(PROMPT_MAX_LENGTH.toLocaleString('vi-VN'));
    expect(warning).not.toContain(pasted);
  });

  it('sends an in-limit prompt verbatim, including surrounding spaces', () => {
    const exact = 'B'.repeat(PROMPT_MAX_LENGTH);
    expect(promptToSend(exact)).toBe(exact);
    const spaced = '  top-down collector  ';
    expect(promptToSend(spaced)).toBe(spaced);
    expect(promptToSend(`${spaced}${'C'.repeat(PROMPT_MAX_LENGTH)}`)).toBeNull();
    expect(promptToSend('   ')).toBeNull();
    expect(promptLimitWarning(exact)).toBe('');
  });
});
