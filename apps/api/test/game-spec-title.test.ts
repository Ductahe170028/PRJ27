import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { GameSpecSchema } from '@game-creator/contracts';
import { createApp } from '../src/app.js';
import { GameGenerationService } from '../src/services/game-generation-service.js';
import { mockProvider, mockRegistry, sampleSpec } from './fixtures.js';

const title = 'SHADOW MAZE – Mê Cung Bóng Tối';
// The character class GameSpec used before dash punctuation was accepted.
const previousLabel = /^[\p{L}\p{M}\p{N} .,!?"'():\-]+$/u;

describe('GameSpec title punctuation', () => {
  it('rejects the Shadow Maze en dash in the previous label class', () => {
    expect(title).toContain('\u2013');
    expect(previousLabel.test(title)).toBe(false);
    expect([...title].filter((character) => !previousLabel.test(character)).map((character) => character.codePointAt(0))).toEqual([0x2013]);
  });

  it('accepts that title in the current schema and still rejects markup, slashes and overlong labels', () => {
    expect(GameSpecSchema.safeParse({ ...sampleSpec('top-down'), title }).success).toBe(true);
    expect(GameSpecSchema.safeParse({ ...sampleSpec('top-down'), title: 'SHADOW MAZE \u2014 Mê Cung' }).success).toBe(true);
    expect(GameSpecSchema.safeParse({ ...sampleSpec('top-down'), title: `${'Á'.repeat(79)}\u2013` }).success).toBe(true);
    const markup = GameSpecSchema.safeParse({ ...sampleSpec('top-down'), title: 'SHADOW <maze>' });
    const slash = GameSpecSchema.safeParse({ ...sampleSpec('top-down'), title: 'http://maze' });
    const overlong = GameSpecSchema.safeParse({ ...sampleSpec('top-down'), title: `${'Á'.repeat(80)}\u2013` });
    const outOfRange = GameSpecSchema.safeParse({
      ...sampleSpec('top-down'),
      player: { ...sampleSpec('top-down').player, x: 1 },
    });
    for (const result of [markup, slash, overlong, outOfRange]) expect(result.success).toBe(false);
    expect(markup.success ? [] : markup.error.issues.map((issue) => issue.path.join('.'))).toContain('title');
  });

  it('publishes the invalid title field with path, code and message', async () => {
    const game = { ...sampleSpec('top-down'), title: 'SHADOW <maze>' };
    const provider = mockProvider('groq', async () => JSON.stringify(game));
    const response = await request(createApp({
      generationService: new GameGenerationService(mockRegistry([provider])),
    })).post('/api/games/generate').send({
      providerId: 'groq', modelId: 'openai/gpt-oss-20b', prompt: 'shadow maze',
    }).expect(422);
    const titleIssue = response.body.error.issues.find((issue: { path?: string }) => issue.path === 'title');
    expect(titleIssue).toEqual({
      path: 'title',
      code: expect.any(String),
      message: expect.any(String),
    });
    expect(response.body.error.message).toContain('Dữ liệu màn chơi không hợp lệ');
    expect(JSON.stringify(response.body)).not.toContain('gsk_');
  });
});
