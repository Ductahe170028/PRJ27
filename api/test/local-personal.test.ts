import type { Request } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_NOTE } from '../../shared/contracts.js';
import { createApp } from '../src/app.js';
import { authenticate } from '../src/auth.js';
import { MockGateway } from '../src/clients/mock-gateway.js';
import { loadConfig, realWritesConfigured } from '../src/config.js';

// Real mode policy is tested using an injected mock gateway. No upstream requests.
const realEnv = {
  API_MODE: 'real', LMS_GRAPHQL_URL: 'https://lms.example.invalid/graphql', DENISE_GRAPHQL_URL: 'https://denise.example.invalid/graphql',
  LMS_AUTH_VALUE: 'test-only-lms', DENISE_AUTH_VALUE: 'test-only-denise',
};
const localEnv = { ...realEnv, LOCAL_PERSONAL_MODE: 'true', HOST: '127.0.0.1', APP_ENV: 'development', TRUSTED_PROXY_AUTH: 'false' };
const input = { studentCode: '26009543', enrollmentId: 'enroll-scratch', studentLessonId: 'sl-8', submissionId: 's8-p1', expectedCategory: 'PRACTICE_TASK1', expectedType: 'SCRATCH', expectedSubmittedCount: 1, note: DEFAULT_NOTE };
function localRequest(remoteAddress = '127.0.0.1', headers: Record<string, string> = {}): Request {
  const values = { host: '127.0.0.1:4000', ...headers };
  return { socket: { remoteAddress }, get: (name: string) => values[name.toLowerCase() as keyof typeof values] } as unknown as Request;
}

describe('local personal mode', () => {
  it('defaults off and still requires real upstream credentials', () => {
    expect(loadConfig({}).LOCAL_PERSONAL_MODE).toBe(false);
    expect(() => loadConfig({ API_MODE: 'real', LOCAL_PERSONAL_MODE: 'true' })).toThrow();
  });
  it.each(['0.0.0.0', 'localhost', '::1', '192.168.1.2'])('rejects nonexact HOST %s', HOST => {
    expect(() => loadConfig({ ...localEnv, HOST })).toThrow('HOST=127.0.0.1');
  });
  it.each(['test', 'staging', 'production'])('rejects APP_ENV=%s', APP_ENV => {
    expect(() => loadConfig({ ...localEnv, APP_ENV })).toThrow('APP_ENV=development');
  });
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('accepts loopback peer %s without role headers', remote => {
    expect(authenticate(localRequest(remote), loadConfig(localEnv))).toMatchObject({ id: 'local-personal', canRead: true });
  });
  it.each(['192.168.1.2', '203.0.113.2', '::ffff:192.168.1.2', ''])('rejects nonloopback peer %s', remote => {
    expect(() => authenticate(localRequest(remote), loadConfig(localEnv))).toThrow('Chế độ cá nhân');
  });
  it('does not trust forged proxy address, identity or role headers', () => {
    expect(() => authenticate(localRequest('203.0.113.2', { 'x-forwarded-for': '127.0.0.1', 'x-tech-id': 'fake-tech', 'x-tech-roles': 'homework-support' }), loadConfig(localEnv))).toThrow('Chế độ cá nhân');
  });
  it('rejects cross-site reads and nonlocal Host headers', () => {
    expect(() => authenticate(localRequest('127.0.0.1', { host: 'example.invalid:4000' }), loadConfig(localEnv))).toThrow('Chế độ cá nhân');
    expect(() => authenticate(localRequest('127.0.0.1', { origin: 'https://example.invalid' }), loadConfig(localEnv))).toThrow('Nguồn yêu cầu');
    expect(() => authenticate(localRequest('127.0.0.1', { 'sec-fetch-site': 'cross-site' }), loadConfig(localEnv))).toThrow('Nguồn yêu cầu');
  });
  it('serves context, exact student search, courses and lessons without a Tech gateway', async () => {
    const gateway = new MockGateway(); const write = vi.spyOn(gateway, 'requestRedo');
    const app = createApp({ config: loadConfig(localEnv), gateway, audit: () => {} });
    const context = await request(app).get('/api/context').set('Host', '127.0.0.1:5173').expect(200);
    expect(context.body).toMatchObject({ mode: 'real', canReopen: false, actorName: 'local-personal' });
    expect(JSON.stringify(context.body)).not.toContain('test-only');
    const student = await request(app).get('/api/students/26009543').expect(200);
    expect(student.body.student.id).toBe('lms-an'); expect(student.body.courses).toHaveLength(3);
    const lessons = await request(app).get('/api/students/26009543/courses/enroll-scratch/lessons').expect(200);
    expect(lessons.body.lessons).toHaveLength(5);
    expect(write).not.toHaveBeenCalled();
  });
  it('rejects invalid origins on actual read endpoints before reaching upstream', async () => {
    const gateway = new MockGateway(); const read = vi.spyOn(gateway, 'findStudents');
    const app = createApp({ config: loadConfig(localEnv), gateway, audit: () => {} });
    await request(app).get('/api/students/26009543').set('Origin', 'https://example.invalid').expect(403);
    await request(app).get('/api/students/26009543').set('Host', 'example.invalid:5173').expect(403);
    expect(read).not.toHaveBeenCalled();
  });
  it.each(['false', 'true'])('keeps local real writes disabled with REAL_MUTATIONS_ENABLED=%s', REAL_MUTATIONS_ENABLED => {
    expect(realWritesConfigured(loadConfig({ ...localEnv, REAL_MUTATIONS_ENABLED, REAL_WRITE_APPROVAL: 'APPROVED_TEST_DATA_ONLY', TRUSTED_PROXY_AUTH: 'true' }))).toBe(false);
  });
  it('rejects a real-mode POST in local development without even reading the target', async () => {
    const gateway = new MockGateway(); const write = vi.spyOn(gateway, 'requestRedo'), read = vi.spyOn(gateway, 'findStudents');
    const app = createApp({ config: loadConfig({ ...localEnv, REAL_MUTATIONS_ENABLED: 'true', REAL_WRITE_APPROVAL: 'APPROVED_TEST_DATA_ONLY', TRUSTED_PROXY_AUTH: 'true' }), gateway, audit: () => {} });
    const response = await request(app).post('/api/reopen').send(input).expect(403);
    expect(response.body.error.code).toBe('REAL_WRITE_DISABLED');
    expect(write).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
});

describe('optional write allowlists (mock gateway only)', () => {
  const writeEnv = { ...realEnv, TRUSTED_PROXY_AUTH: 'true', APP_ENV: 'test', REAL_MUTATIONS_ENABLED: 'true', REAL_WRITE_APPROVAL: 'APPROVED_TEST_DATA_ONLY' };
  it.each([
    ['', '', 200],
    [' ,  , ', ' , ', 200],
    ['lms-an', '', 200],
    ['', 'scratch-2', 200],
    [' lms-other , lms-an ', 'python-1,scratch-2', 200],
    ['lms-other', '', 403],
    ['', 'other-course', 403],
    ['lms-an', 'other-course', 403],
    ['lms-other', 'scratch-2', 403],
    ['26009543', 'scratch-2', 403],
    ['lms-an', 'enroll-scratch', 403],
  ])('student list %j and course list %j returns %i', async (students, courses, status) => {
    const config = loadConfig({ ...writeEnv, APPROVED_TEST_LMS_IDS: students as string, APPROVED_TEST_COURSE_IDS: courses as string });
    expect(realWritesConfigured(config)).toBe(true);
    const gateway = new MockGateway(); const write = vi.spyOn(gateway, 'requestRedo');
    const app = createApp({ config, gateway, audit: () => {} });
    const response = await request(app).post('/api/reopen').set('x-tech-id', 'test-tech').set('x-tech-roles', 'homework-support').send(input).expect(status as number);
    if (status === 200) { expect(response.body.verified).toBe(true); expect(write).toHaveBeenCalledTimes(1); }
    else { expect(response.body.error.code).toBe('TEST_DATA_NOT_APPROVED'); expect(write).not.toHaveBeenCalled(); }
  });
  it.each([
    { REAL_MUTATIONS_ENABLED: 'false' },
    { REAL_WRITE_APPROVAL: '' },
    { REAL_WRITE_APPROVAL: 'anything-else' },
    { APP_ENV: 'development' },
    { APP_ENV: 'production' },
    { TRUSTED_PROXY_AUTH: 'false' },
  ])('empty allowlists do not bypass other write gates: %j', override => {
    expect(realWritesConfigured(loadConfig({ ...writeEnv, ...override, APPROVED_TEST_LMS_IDS: '', APPROVED_TEST_COURSE_IDS: '' }))).toBe(false);
  });
  it('populated write allowlists do not restrict personal-mode reads', async () => {
    const app = createApp({ config: loadConfig({ ...localEnv, APPROVED_TEST_LMS_IDS: 'different-student', APPROVED_TEST_COURSE_IDS: 'different-course' }), gateway: new MockGateway(), audit: () => {} });
    await request(app).get('/api/students/26009543').expect(200);
    await request(app).get('/api/students/26009543/courses/enroll-scratch/lessons').expect(200);
  });
});
