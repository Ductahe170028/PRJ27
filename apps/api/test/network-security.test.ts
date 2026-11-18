import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AgentOrchestrator } from '../src/agent/orchestrator.js';
import { createApp } from '../src/app.js';
import { clientKey } from '../src/http/client-key.js';
import { resolveTrustProxy } from '../src/http/trust-proxy.js';
import { GameGenerationService } from '../src/services/game-generation-service.js';
import { RequestBudget } from '../src/services/request-budget.js';
import { mockProvider, mockRegistry } from './fixtures.js';

const selection = { providerId: 'gemini', modelId: 'gemini-3.5-flash-lite' };
function appWith(budget: RequestBudget, trustProxy: 'loopback' | false) {
  const service = new GameGenerationService(mockRegistry([mockProvider()]), budget);
  return createApp({ generationService: service, trustProxy, advancedEnabled: false });
}
const probe = (app: ReturnType<typeof createApp>, forwarded?: string) => {
  const call = request(app).post('/api/ai/test-connection').send(selection);
  return forwarded === undefined ? call : call.set('X-Forwarded-For', forwarded);
};

describe('clientKey', () => {
  it.each([
    [undefined, 'local'], ['', 'local'], ['not an address', 'local'],
    ['203.0.113.7', '203.0.113.7'], ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:db8:1:2::1', '2001:db8:1:2::/64'], ['2001:0db8:0001:0002:ffff::9', '2001:db8:1:2::/64'],
    ['::1', '0:0:0:0::/64'], ['fe80::1%eth0', 'fe80:0:0:0::/64'],
  ])('maps %s to %s', (address, expected) => { expect(clientKey(address)).toBe(expected); });

  it('gives every address in one IPv6 /64 the same key, so a host cannot dodge limits by rotating addresses', () => {
    const keys = new Set(Array.from({ length: 50 }, (_, i) => clientKey(`2001:db8:5:6:${i.toString(16)}::${(i * 7).toString(16)}`)));
    expect(keys.size).toBe(1);
    expect(clientKey('2001:db8:5:7::1')).not.toBe([...keys][0]);
  });
});

describe('resolveTrustProxy', () => {
  it('is loopback in production by default and off for local development', () => {
    expect(resolveTrustProxy({ NODE_ENV: 'production' })).toBe('loopback');
    expect(resolveTrustProxy({})).toBe(false);
  });
  it.each([['loopback', 'loopback'], ['LOOPBACK', 'loopback'], ['off', false], ['false', false], ['0', false]] as const)('accepts %s', (value, expected) => {
    expect(resolveTrustProxy({ TRUST_PROXY: value, NODE_ENV: 'production' })).toBe(expected);
  });
  it.each(['true', '1', '2', 'uniquelocal', '10.0.0.0/8', '0.0.0.0/0', '*', 'yes'])('refuses %s: it would trust a client-controlled header', (value) => {
    expect(() => resolveTrustProxy({ TRUST_PROXY: value })).toThrow(/TRUST_PROXY/);
  });
});

describe('client address behind the Nginx on loopback (trust proxy = loopback)', () => {
  it('uses the address Nginx put in X-Forwarded-For as the rate-limit key', async () => {
    const app = appWith(new RequestBudget({ requestsPerMinute: 1 }), 'loopback');
    await probe(app, '203.0.113.5').expect(200);
    await probe(app, '203.0.113.5').expect(429);
    await probe(app, '198.51.100.9').expect(200); // a different real client has its own window
  });

  it('ignores addresses a client prepended to the chain (Nginx appends nothing: it overwrites)', async () => {
    const app = appWith(new RequestBudget({ requestsPerMinute: 1 }), 'loopback');
    await probe(app, '203.0.113.5').expect(200);
    // A spoofer cannot pick the key: the rightmost non-loopback hop wins.
    await probe(app, '1.2.3.4, 203.0.113.5').expect(429);
    await probe(app, '9.9.9.9, 8.8.8.8, 203.0.113.5').expect(429);
  });

  it('keeps one IPv6 /64 in one window', async () => {
    const app = appWith(new RequestBudget({ requestsPerMinute: 1 }), 'loopback');
    await probe(app, '2001:db8:1:1::a').expect(200);
    await probe(app, '2001:db8:1:1:ffff::b').expect(429);
  });
});

describe('client address when no proxy is trusted (local development)', () => {
  it('ignores X-Forwarded-For entirely, so it cannot be used to evade or frame anyone', async () => {
    const app = appWith(new RequestBudget({ requestsPerMinute: 1 }), false);
    await probe(app, '203.0.113.5').expect(200);
    await probe(app, '198.51.100.9').expect(429);
    await probe(app, '1.1.1.1, 2.2.2.2').expect(429);
    await probe(app).expect(429);
  });

  it('does not let X-Real-IP, Forwarded or X-Client-IP change the key', async () => {
    const app = appWith(new RequestBudget({ requestsPerMinute: 1 }), 'loopback');
    await request(app).post('/api/ai/test-connection').set('X-Real-IP', '10.0.0.1').set('Forwarded', 'for=10.0.0.2').set('X-Client-IP', '10.0.0.3').send(selection).expect(200);
    await request(app).post('/api/ai/test-connection').set('X-Real-IP', '10.9.9.9').set('Forwarded', 'for=10.9.9.9').set('X-Client-IP', '10.9.9.9').send(selection).expect(429);
  });
});

describe('Host, Origin and forwarded headers are not proof of anything', () => {
  const agent = () => {
    const service = new GameGenerationService(mockRegistry([mockProvider('groq')]));
    return createApp({ generationService: service, agent: new AgentOrchestrator(service, { test: async () => ({ errors: [] }) }), advancedEnabled: true, trustProxy: 'loopback' });
  };
  const body = { providerId: 'groq', prompt: 'Tạo game bắn máy bay' };

  it.each([
    ['public Host', { Host: 'game.example.com' }],
    ['public Host plus forwarded localhost', { Host: 'game.example.com', 'X-Forwarded-Host': 'localhost', 'X-Forwarded-For': '127.0.0.1' }],
    ['localhost Host but public Origin', { Host: 'localhost:3001', Origin: 'https://game.example.com' }],
    ['Host that only starts with localhost', { Host: 'localhost.evil.test' }],
  ])('refuses Advanced for %s', async (_name, headers) => {
    const response = await request(agent()).post('/api/agent/generate').set(headers).send(body).expect(403);
    expect(response.body.error.code).toBe('advanced_unavailable');
  });

  it('reports Advanced disabled to a public Host', async () => {
    const response = await request(agent()).get('/api/agent/config').set('Host', 'game.example.com').expect(200);
    expect(response.body.enabled).toBe(false);
  });
});

describe('request size limits', () => {
  const app = () => appWith(new RequestBudget({ requestsPerMinute: 100 }), 'loopback');
  it.each(['/api/games/generate', '/api/ai/test-connection', '/api/agent/generate'])('answers 413 for an oversized body on %s without calling a provider', async (path) => {
    const response = await request(app()).post(path).set('Content-Type', 'application/json').send(JSON.stringify({ prompt: 'x'.repeat(40_000) }));
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
  it('still accepts a body just under the limit', async () => {
    const response = await request(app()).post('/api/ai/test-connection').set('Content-Type', 'application/json').send(JSON.stringify({ ...selection, pad: 'x'.repeat(8_000) }));
    expect(response.status).not.toBe(413);
  });
});

describe('RequestBudget memory bound', () => {
  it('removes expired client windows, so the map does not grow forever', () => {
    let now = 1_000_000;
    const budget = new RequestBudget({ requestsPerMinute: 5, requestsPerDay: 100_000, maxConcurrent: 100_000, now: () => now });
    for (let i = 0; i < 500; i += 1) budget.acquire(`client-${i}`)();
    expect(budget.trackedClients).toBe(500);
    now += 61_000;
    budget.acquire('later')();
    expect(budget.trackedClients).toBe(1);
  });

  it('refuses new clients (429) once maxClients is reached instead of growing, while known clients still count', () => {
    const budget = new RequestBudget({ requestsPerMinute: 5, requestsPerDay: 100_000, maxConcurrent: 100_000, maxClients: 3, now: () => 1_000 });
    for (const id of ['a', 'b', 'c']) budget.acquire(id)();
    expect(() => budget.acquire('d')).toThrowError(expect.objectContaining({ code: 'rate_limit', status: 429 }));
    expect(budget.trackedClients).toBe(3);
    expect(() => budget.acquire('a')).not.toThrow();
  });

  it('never exceeds the default bound of 1000 tracked clients under a flood of distinct addresses', () => {
    const budget = new RequestBudget({ requestsPerMinute: 5, requestsPerDay: 1_000_000, maxConcurrent: 1_000_000, now: () => 5_000 });
    let rejected = 0;
    for (let i = 0; i < 5_000; i += 1) { try { budget.acquire(`ip-${i}`)(); } catch { rejected += 1; } }
    expect(budget.trackedClients).toBe(1_000);
    expect(rejected).toBe(4_000);
  });

  it('enforces the daily total and the concurrent total for everyone together (shared IPs, no user id)', () => {
    const budget = new RequestBudget({ requestsPerMinute: 50, requestsPerDay: 3, maxConcurrent: 2, now: () => 10 });
    const first = budget.acquire('a'); const second = budget.acquire('b');
    expect(() => budget.acquire('c')).toThrowError(/đồng thời/);
    first(); second();
    budget.acquire('c')();
    expect(() => budget.acquire('d')).toThrowError(/trong ngày/);
  });
});

describe('error responses', () => {
  it('sends Retry-After with a 429', async () => {
    const app = appWith(new RequestBudget({ requestsPerMinute: 1 }), 'loopback');
    await probe(app, '203.0.113.5').expect(200);
    const limited = await probe(app, '203.0.113.5').expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.body.error.code).toBe('rate_limit');
  });
  it('does not log or return the client address', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = appWith(new RequestBudget({ requestsPerMinute: 1 }), 'loopback');
    await probe(app, '203.0.113.5').expect(200);
    const limited = await probe(app, '203.0.113.5').expect(429);
    expect(JSON.stringify(limited.body)).not.toContain('203.0.113.5');
    log.mockRestore();
  });
});
