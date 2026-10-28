import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { GenerateGameResponseSchema } from '@game-creator/contracts';
import { createApp } from '../src/app.js';
import { GameService } from '../src/services/game-service.js';

const app = createApp();

describe('demo API', () => {
  it('reports health and multi-provider mode', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', service: 'ai-game-creator-api', mode: 'multi-provider' });
  });

  it('returns a validated level and retains the prompt only as data', async () => {
    const prompt = '<script>window.parent.document.body.remove()</script>';
    const response = await request(app).post('/api/games/generate').send({ prompt }).expect(201);
    const result = GenerateGameResponseSchema.parse(response.body);
    expect(result.data.prompt).toBe(prompt);
    expect(result.data.provider).toBe('demo');
    expect(result.data.game.platforms).toHaveLength(5);
    expect(result.data.game).not.toHaveProperty('code');
    expect(result.data.game).not.toHaveProperty('html');
  });

  it.each([{}, { prompt: '' }, { prompt: '   ' }, { prompt: 42 }, { prompt: 'x'.repeat(2001) }, { prompt: 'game', code: 'alert(1)' }])(
    'rejects invalid input: %j', async (body) => {
      const response = await request(app).post('/api/games/generate').send(body).expect(400);
      expect(response.body.error.code).toBe('INVALID_PROMPT');
    },
  );

  it('rejects malformed JSON', async () => {
    const response = await request(app).post('/api/games/generate').type('json').send('{').expect(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });

  it('limits request body size', async () => {
    const response = await request(app).post('/api/games/generate').send({ prompt: 'a'.repeat(20_000) }).expect(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns a JSON 404', async () => {
    const response = await request(app).get('/api/missing').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('handles provider failures without exposing internal errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const service = new GameService({ generate: async () => { throw new Error('private provider detail'); } });
      const response = await request(createApp({ service })).post('/api/games/generate').send({ prompt: 'A platform game' }).expect(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(response.body)).not.toContain('private provider detail');
    } finally {
      spy.mockRestore();
    }
  });
});
