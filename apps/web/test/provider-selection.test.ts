import { describe, expect, it } from 'vitest';
import { SHOOTER_LEVELS } from '@game-creator/contracts';
import { DEMO, DEMO_TITLE, STORAGE_KEY, isDemoSelection, loadSelection, selectionFrom } from '../src/lib/provider-selection';

describe('the choice of provider and model saved in the browser', () => {
  it('the demo is the arena, under the id the server answers with', () => {
    expect(DEMO).toEqual({ providerId: 'demo', modelId: 'shooter-arena' });
    expect(DEMO_TITLE).toBe(SHOOTER_LEVELS.arena.title);
    expect(isDemoSelection(DEMO)).toBe(true);
    expect(isDemoSelection({ providerId: 'groq', modelId: 'auto' })).toBe(false);
  });

  it('a saved demo under the old id (the platformer game) quietly becomes the demo', () => {
    expect(selectionFrom({ providerId: 'demo', modelId: 'platformer-v1' })).toEqual(DEMO);
    expect(isDemoSelection(selectionFrom({ providerId: 'demo', modelId: 'platformer-v1' }))).toBe(true);
  });

  it('keeps a real choice as it was saved', () => {
    expect(selectionFrom({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' })).toEqual({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' });
    expect(selectionFrom({ providerId: 'gemini', modelId: 'auto' })).toEqual({ providerId: 'gemini', modelId: 'auto' });
    expect(selectionFrom(DEMO)).toEqual(DEMO);
  });

  it('an empty model id from an older version means "automatic"', () => {
    expect(selectionFrom({ providerId: 'groq', modelId: '' })).toEqual({ providerId: 'groq', modelId: 'auto' });
  });

  it.each([null, undefined, 'groq', 42, {}, { providerId: 'groq' }, { providerId: 'Bad Id', modelId: 'x' }, { providerId: 'groq', modelId: 'a b' }, []])('a value that is not a choice (%j) is the demo', (saved) => {
    expect(selectionFrom(saved)).toEqual(DEMO);
  });

  it('reads the saved text, and falls back to the demo when there is none, it is not JSON, or storage is disabled', () => {
    expect(STORAGE_KEY).toBe('game-creator.provider.v1');
    expect(loadSelection(() => JSON.stringify({ providerId: 'demo', modelId: 'platformer-v1' }))).toEqual(DEMO);
    expect(loadSelection(() => JSON.stringify({ providerId: 'groq', modelId: 'auto' }))).toEqual({ providerId: 'groq', modelId: 'auto' });
    expect(loadSelection(() => null)).toEqual(DEMO);
    expect(loadSelection(() => '{not json')).toEqual(DEMO);
    expect(loadSelection(() => { throw new Error('storage disabled'); })).toEqual(DEMO);
  });
});
