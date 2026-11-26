import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { ApiErrorSchema, GenerateShooterResponseSchema, HealthResponseSchema, ProvidersResponseSchema, TestConnectionResponseSchema } from '@game-creator/contracts';
import { createApp } from '../src/app.js';
import { AiGateway } from '../src/services/ai-gateway.js';
import { ShooterService } from '../src/shooter/service.js';
import { mockProvider, mockRegistry } from './fixtures.js';

const app = createApp();

/** The public API: GET /api/health, GET /api/ai/providers, POST /api/ai/test-connection, POST /api/shooter/generate. */
describe('the public API', () => {
  it('reports health and multi-provider mode', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', service: 'ai-game-creator-api', mode: 'multi-provider' });
    expect(HealthResponseSchema.safeParse(response.body).success).toBe(true);
  });

  it('lists the providers in the shape the web app validates', async () => {
    const response = await request(app).get('/api/ai/providers').expect(200);
    expect(ProvidersResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.providers.map((provider: { id: string }) => provider.id)).toEqual(['gemini', 'groq']);
  });

  it('checks a connection in the shape the web app validates, and refuses a bad choice with 400', async () => {
    const gateway = new AiGateway(mockRegistry());
    const server = createApp({ gateway });
    const ok = await request(server).post('/api/ai/test-connection').send({ providerId: 'gemini' }).expect(200);
    expect(TestConnectionResponseSchema.safeParse(ok.body).success).toBe(true);
    const bad = await request(server).post('/api/ai/test-connection').send({ providerId: 'Bad Provider' }).expect(400);
    expect(bad.body.error).toMatchObject({ code: 'invalid_model', message: 'Hãy chọn provider và model hợp lệ.' });
  });

  it('the demo returns a validated level and keeps the prompt only as data', async () => {
    const prompt = '<script>window.parent.document.body.remove()</script>';
    const response = await request(app).post('/api/shooter/generate').send({ prompt }).expect(201);
    const result = GenerateShooterResponseSchema.parse(response.body);
    expect(result.data.prompt).toBe(prompt);
    expect(result.data.provider).toBe('demo');
    expect(result.data.modelId).toBe('shooter-arena');
    expect(result.data.level.waves.length).toBeGreaterThan(0);
    expect(result.data.level).not.toHaveProperty('code');
    expect(result.data.level).not.toHaveProperty('html');
  });

  it.each([{}, { prompt: '' }, { prompt: '   ' }, { prompt: 42 }, { prompt: 'x'.repeat(2001) }, { prompt: 'game', code: 'alert(1)' }])(
    'rejects invalid input: %j', async (body) => {
      const response = await request(app).post('/api/shooter/generate').send(body).expect(400);
      expect(response.body.error.code).toBe('INVALID_PROMPT');
    },
  );

  it('rejects malformed JSON', async () => {
    const response = await request(app).post('/api/shooter/generate').type('json').send('{').expect(400);
    expect(response.body.error).toEqual({ code: 'INVALID_JSON', message: 'Nội dung JSON không hợp lệ.' });
  });

  it('limits the body to 16 KB', async () => {
    const response = await request(app).post('/api/shooter/generate').send({ prompt: 'a'.repeat(20_000) }).expect(413);
    expect(response.body.error).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'Dữ liệu gửi lên quá lớn.' });
    const under = await request(app).post('/api/ai/test-connection').send({ providerId: 'gemini', pad: 'x'.repeat(8_000) });
    expect(under.status).not.toBe(413);
  });

  it('answers a JSON 404 for anything else, including the routes that no longer exist', async () => {
    const expected = { error: { code: 'NOT_FOUND', message: 'API không tồn tại.' } };
    expect((await request(app).get('/api/missing').expect(404)).body).toEqual(expected);
    expect((await request(app).post('/api/games/generate').send({ prompt: 'A platform game' }).expect(404)).body).toEqual(expected);
    expect((await request(app).post('/api/agent/generate').send({ prompt: 'A game' }).expect(404)).body).toEqual(expected);
    expect((await request(app).get('/api/agent/config').expect(404)).body).toEqual(expected);
    expect(ApiErrorSchema.safeParse(expected).success).toBe(true);
  });

  it('never lets a response be cached or sniffed, errors included', async () => {
    for (const response of [
      await request(app).get('/api/health'),
      await request(app).get('/api/ai/providers'),
      await request(app).post('/api/shooter/generate').send({ prompt: 'zombie' }),
      await request(app).post('/api/shooter/generate').send({}),
      await request(app).get('/api/missing'),
    ]) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('allows the two local web origins and no other', async () => {
    const allowed = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const other = await request(app).get('/api/health').set('Origin', 'https://example.org');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    const custom = createApp({ clientOrigins: ['https://creator.example'] });
    const own = await request(custom).get('/api/health').set('Origin', 'https://creator.example');
    expect(own.headers['access-control-allow-origin']).toBe('https://creator.example');
  });

  it('handles an unexpected failure without exposing internal errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const gateway = new AiGateway(mockRegistry([mockProvider('groq')]));
      const shooterService = new ShooterService(gateway, { compile: async () => { throw new Error('private compiler detail'); } });
      const response = await request(createApp({ gateway, shooterService })).post('/api/shooter/generate').send({ providerId: 'groq', prompt: 'A shooter' }).expect(500);
      expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Không thể tạo game lúc này. Hãy thử lại.' });
      expect(JSON.stringify(response.body)).not.toContain('private compiler detail');
    } finally {
      spy.mockRestore();
    }
  });
});
