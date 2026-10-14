import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GraphqlClient } from '../src/clients/graphql.js';
import { RealGateway } from '../src/clients/real-gateway.js';
import { loadConfig } from '../src/config.js';

const options = { url: 'https://example.invalid/graphql', authHeader: 'Authorization', authValue: 'test-placeholder', timeoutMs: 100 };
const schema = z.object({ value: z.string() });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
describe('GraphQL transport (all network calls stubbed)', () => {
  it('sends documents and variables with credentials only in backend headers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ data: { value: 'ok' } }));
    expect(await new GraphqlClient(options, fetcher).execute('query Q { value }', { id: '123' }, schema)).toEqual({ value: 'ok' });
    const init = fetcher.mock.calls[0]![1]!;
    expect(init.headers).toMatchObject({ Authorization: 'test-placeholder' });
    expect(JSON.parse(init.body as string)).toEqual({ query: 'query Q { value }', variables: { id: '123' } });
    expect(init.redirect).toBe('error');
  });
  it.each([
    [{ data: { value: 'ok' }, errors: [{ message: 'secret upstream message' }] }, 200, 'UPSTREAM_GRAPHQL'],
    [{ errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] }, 200, 'UPSTREAM_AUTH'],
    [{ data: { value: 12 } }, 200, 'UPSTREAM_INVALID_DATA'],
    [{ data: { value: 'ok' } }, 401, 'UPSTREAM_AUTH'],
    [{ data: { value: 'ok' } }, 403, 'UPSTREAM_AUTH'],
    [{ data: { value: 'ok' } }, 500, 'UPSTREAM_HTTP'],
  ])('rejects invalid response %j at %s', async (json, status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(json, status as number));
    await expect(new GraphqlClient(options, fetcher).execute('query Q { value }', {}, schema)).rejects.toMatchObject({ code });
  });
  it('rejects invalid JSON without reflecting content', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret-invalid-json'));
    await expect(new GraphqlClient(options, fetcher).execute('query Q { value }', {}, schema)).rejects.toMatchObject({ code: 'UPSTREAM_INVALID_DATA' });
  });
  it('bounds timeout and marks a write uncertain without retry', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')));
    }));
    await expect(new GraphqlClient(options, fetcher).execute('mutation Q { value }', {}, schema, true)).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT', uncertain: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('handles network errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network'));
    await expect(new GraphqlClient(options, fetcher).execute('query Q { value }', {}, schema)).rejects.toMatchObject({ code: 'UPSTREAM_NETWORK' });
  });
  it('keeps the timeout active while reading the response body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const result = response({ data: { value: 'ok' } });
      result.json = () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')));
      });
      return result;
    });
    await expect(new GraphqlClient(options, fetcher).execute('query Q { value }', {}, schema)).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('uses the documented LMS -> studentServiceId -> studentUid mapping and mutation variables', async () => {
    const config = loadConfig({ API_MODE: 'real', LMS_GRAPHQL_URL: 'https://lms.example.invalid/graphql', DENISE_GRAPHQL_URL: 'https://denise.example.invalid/graphql', LMS_AUTH_VALUE: 'test-only', DENISE_AUTH_VALUE: 'test-only' });
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ data: { students: { data: [{ id: 'lms-object-id', fullName: 'Test', studentId: '123' }], pagination: { total: 1 } } } }))
      .mockResolvedValueOnce(response({ data: { StudentCourse_findAll: [] } }))
      .mockResolvedValueOnce(response({ data: { StudentLesson_find: { course: { id: 'course', name: 'Course' }, classes: [], lessons: [] } } }))
      .mockResolvedValueOnce(response({ data: { StudentSubmission_findById: null } }))
      .mockResolvedValueOnce(response({ data: { StudentSubmission_requestRedoSubmission: { id: 'submission', status: 'REDO', note: 'reason' } } }));
    const gateway = new RealGateway(config, fetcher);
    await gateway.findStudents('123'); await gateway.findCourses('lms-object-id'); await gateway.findLessons('course', 'base-user-id'); await gateway.findSubmission('submission'); await gateway.requestRedo('submission', 'reason');
    const variables = fetcher.mock.calls.map(call => JSON.parse(call[1]!.body as string).variables);
    expect(variables).toEqual([{ p: { filter_textSearch: '123', itemsPerPage: 5 } }, { in: { studentServiceId: 'lms-object-id', isDeleted: false } }, { p: { courseId: 'course', studentId: 'base-user-id' } }, { id: 'submission' }, { payload: { id: 'submission', note: 'reason' } }]);
  });
  it('refuses incomplete LMS pages instead of inventing an unverified pagination field', async () => {
    const config = loadConfig({ API_MODE: 'real', LMS_GRAPHQL_URL: 'https://lms.example.invalid/graphql', DENISE_GRAPHQL_URL: 'https://denise.example.invalid/graphql', LMS_AUTH_VALUE: 'test-only', DENISE_AUTH_VALUE: 'test-only' });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ data: { students: { data: [{ id: 'student', fullName: 'Test', studentId: '123' }], pagination: { total: 8 } } } }));
    await expect(new RealGateway(config, fetcher).findStudents('123')).rejects.toMatchObject({ code: 'LMS_SEARCH_INCOMPLETE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
