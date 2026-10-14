import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_NOTE } from '../../shared/contracts.js';
import { createApp } from '../src/app.js';
import { MockGateway } from '../src/clients/mock-gateway.js';
import { loadConfig, realWritesConfigured } from '../src/config.js';

const input = { studentCode: '26009543', enrollmentId: 'enroll-scratch', studentLessonId: 'sl-8', submissionId: 's8-p1', expectedCategory: 'PRACTICE_TASK1', expectedType: 'SCRATCH', expectedSubmittedCount: 1, note: DEFAULT_NOTE };
const realEnv = { API_MODE: 'real', LMS_GRAPHQL_URL: 'https://lms.example.invalid/graphql', DENISE_GRAPHQL_URL: 'https://denise.example.invalid/graphql', LMS_AUTH_VALUE: 'test-secret-lms', DENISE_AUTH_VALUE: 'test-secret-denise' };
const mockApp = () => createApp({ config: loadConfig({ API_MODE: 'mock' }), gateway: new MockGateway(), audit: () => {} });
describe('HTTP API', () => {
  it('completes search -> courses -> lessons -> prepare -> reopen -> verify using mock only', async () => {
    const app = mockApp();
    const context = await request(app).get('/api/context').expect(200);
    expect(context.body).toMatchObject({ mode: 'mock', canReopen: true });
    const search = await request(app).get('/api/students/26009543').expect(200);
    expect(search.body.student.fullName).toBe('Nguyễn Hoàng An');
    const list = await request(app).get('/api/students/26009543/courses/enroll-scratch/lessons').expect(200);
    expect(list.body.lessons).toHaveLength(5);
    const preparation = await request(app).get('/api/students/26009543/courses/enroll-scratch/lessons/sl-8/submissions/s8-p1').expect(200);
    expect(preparation.body.status).toBe('SUBMITTED');
    const reopened = await request(app).post('/api/reopen').set('Origin', 'http://127.0.0.1:5173').send(input).expect(200);
    expect(reopened.body).toMatchObject({ verified: true, submission: { id: 's8-p1', status: 'REDO' } });
    const refreshed = await request(app).get('/api/students/26009543/courses/enroll-scratch/lessons').expect(200);
    expect(refreshed.body.lessons[0].submissions[1].status).toBe('REDO');
    await request(app).post('/api/reopen').send(input).expect(409);
  });
  it.each([{ ...input, note: '   ' }, { ...input, note: 'x'.repeat(1001) }, { ...input, studentCode: 'bad' }, { ...input, expectedSubmittedCount: -1 }, { ...input, expectedCategory: 'QUIZ' }, { ...input, extra: 'arbitrary-query' }])('validates request %j', async body => {
    const response = await request(mockApp()).post('/api/reopen').send(body).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.requestId).toBeTruthy();
  });
  it('validates malformed JSON, content type, large body and unknown endpoint', async () => {
    await request(mockApp()).post('/api/reopen').set('Content-Type', 'application/json').send('{bad').expect(400);
    await request(mockApp()).post('/api/reopen').send('text').expect(415);
    await request(mockApp()).post('/api/reopen').send({ ...input, note: 'x'.repeat(20000) }).expect(413);
    await request(mockApp()).post('/api/graphql').send({ query: 'mutation { anything }' }).expect(404);
    await request(mockApp()).get('/api/students/invalid').expect(400);
  });
  it('rejects writes from unapproved origins and cross-site requests', async () => {
    await request(mockApp()).post('/api/reopen').set('Origin', 'https://evil.example.invalid').send(input).expect(403);
    await request(mockApp()).post('/api/reopen').set('Sec-Fetch-Site', 'cross-site').send(input).expect(403);
  });
  it('protects all real reads and writes before invoking a gateway', async () => {
    const gateway = new MockGateway();
    const read = vi.spyOn(gateway, 'findStudents'), write = vi.spyOn(gateway, 'requestRedo');
    const app = createApp({ config: loadConfig(realEnv), gateway, audit: () => {} });
    await request(app).get('/api/students/26009543').expect(401);
    await request(app).get('/api/context').expect(401);
    await request(app).post('/api/reopen').send(input).expect(401);
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });
  it('requires company gateway identity and role; no client token is exposed', async () => {
    const app = createApp({ config: loadConfig({ ...realEnv, TRUSTED_PROXY_AUTH: 'true' }), gateway: new MockGateway(), audit: () => {} });
    await request(app).get('/api/context').expect(401);
    await request(app).get('/api/context').set('x-tech-id', 'tech.test').set('x-tech-roles', 'student').expect(403);
    const response = await request(app).get('/api/context').set('x-tech-id', 'tech.test').set('x-tech-roles', 'homework-support').expect(200);
    expect(response.body).toMatchObject({ mode: 'real', canReopen: false });
    expect(JSON.stringify(response.body)).not.toContain('test-secret');
  });
  it('defaults to locked real writes even with an authenticated Tech', async () => {
    const gateway = new MockGateway(); const write = vi.spyOn(gateway, 'requestRedo');
    const app = createApp({ config: loadConfig({ ...realEnv, TRUSTED_PROXY_AUTH: 'true' }), gateway, audit: () => {} });
    const response = await request(app).post('/api/reopen').set('x-tech-id', 'tech.test').set('x-tech-roles', 'homework-support').send(input).expect(403);
    expect(response.body.error.code).toBe('REAL_WRITE_DISABLED'); expect(write).not.toHaveBeenCalled();
  });
  it('blocks real test writes for non-allowlisted data (gateway remains a mock)', async () => {
    const config = loadConfig({ ...realEnv, TRUSTED_PROXY_AUTH: 'true', REAL_MUTATIONS_ENABLED: 'true', REAL_WRITE_APPROVAL: 'APPROVED_TEST_DATA_ONLY', APP_ENV: 'test', APPROVED_TEST_LMS_IDS: 'other-student', APPROVED_TEST_COURSE_IDS: 'scratch-2' });
    const gateway = new MockGateway(); const write = vi.spyOn(gateway, 'requestRedo');
    const app = createApp({ config, gateway, audit: () => {} });
    const response = await request(app).post('/api/reopen').set('x-tech-id', 'tech.test').set('x-tech-roles', 'homework-support').send(input).expect(403);
    expect(response.body.error.code).toBe('TEST_DATA_NOT_APPROVED'); expect(write).not.toHaveBeenCalled();
  });
  it('adds no-store and security headers to sensitive responses', async () => {
    const response = await request(mockApp()).get('/api/students/26009543').expect(200);
    expect(response.headers['cache-control']).toBe('no-store'); expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
describe('real mode configuration', () => {
  it('fails closed with missing credentials, invalid endpoints and unverified auth setup', () => {
    expect(() => loadConfig({ API_MODE: 'real' })).toThrow();
    expect(() => loadConfig({ ...realEnv, LMS_GRAPHQL_URL: 'http://example.invalid/graphql' })).toThrow();
    expect(() => loadConfig({ ...realEnv, LMS_AUTH_VALUE: '' })).toThrow();
    expect(() => loadConfig({ ...realEnv, LMS_AUTH_HEADER: 'bad\r\nheader' })).toThrow();
    expect(realWritesConfigured(loadConfig(realEnv))).toBe(false);
  });
  it.each(['development', 'production'])('never enables real mutation in %s', APP_ENV => {
    expect(realWritesConfigured(loadConfig({ ...realEnv, APP_ENV, TRUSTED_PROXY_AUTH: 'true', REAL_MUTATIONS_ENABLED: 'true', REAL_WRITE_APPROVAL: 'APPROVED_TEST_DATA_ONLY', APPROVED_TEST_LMS_IDS: 'test', APPROVED_TEST_COURSE_IDS: 'test' }))).toBe(false);
  });
});
