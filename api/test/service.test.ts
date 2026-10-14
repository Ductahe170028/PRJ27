import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NOTE, type ReopenInput } from '../../shared/contracts.js';
import { MockGateway } from '../src/clients/mock-gateway.js';
import { loadConfig } from '../src/config.js';
import { AppError } from '../src/errors.js';
import { ReopenService, type AuditEntry } from '../src/services/reopen-service.js';

const actor = { id: 'test-tech', canRead: true, canReopen: true };
const input: ReopenInput = { studentCode: '26009543', enrollmentId: 'enroll-scratch', studentLessonId: 'sl-8', submissionId: 's8-p1', expectedCategory: 'PRACTICE_TASK1', expectedType: 'SCRATCH', expectedSubmittedCount: 1, note: DEFAULT_NOTE };
describe('ReopenService', () => {
  let mock: MockGateway, service: ReopenService, audit: AuditEntry[];
  beforeEach(() => { mock = new MockGateway(); audit = []; service = new ReopenService(mock, loadConfig({ API_MODE: 'mock' }), entry => audit.push(entry)); });
  it('matches code exactly even when first search hit is a fuzzy match', async () => {
    expect((await service.search('26009543', actor)).student.id).toBe('lms-an');
    expect((await service.search('26009543', actor)).courses).toHaveLength(3);
  });
  it.each([['12345', 'STUDENT_NOT_FOUND'], ['26000003', 'STUDENT_AMBIGUOUS'], ['26000005', 'LMS_SEARCH_INCOMPLETE'], ['26000001', 'DENISE_STUDENT_NOT_FOUND']])('rejects %s with %s', async (code, error) => {
    await expect(service.search(code!, actor)).rejects.toMatchObject({ code: error });
  });
  it('handles no courses and retains completed courses', async () => {
    expect((await service.search('26000002', actor)).courses).toEqual([]);
    expect((await service.search('26009543', actor)).courses.some(c => c.status === 'COMPLETED')).toBe(true);
  });
  it('reopens a single submitted part while sibling is in progress and leaves quiz and lesson alone', async () => {
    const write = vi.spyOn(mock, 'requestRedo');
    expect((await service.prepare('26009543', 'enroll-scratch', 'sl-8', 's8-p1', actor)).submittedCount).toBe(1);
    const result = await service.reopen(input, actor, 'req-1');
    expect(result.verified).toBe(true);
    expect(result.submission.status).toBe('REDO');
    expect(write).toHaveBeenCalledExactlyOnceWith('s8-p1', DEFAULT_NOTE);
    expect(mock.details.get('s8-p2')?.status).toBe('IN_PROGRESS');
    expect(mock.details.get('s8-quiz')?.status).toBe('MARKED');
    expect(mock.lessons.find(l => l.id === 'sl-8')?.status).toBe('IN_PROGRESS');
    expect(audit.map(e => e.result)).toEqual(['started', 'verified']);
    expect(JSON.stringify(audit)).not.toContain(DEFAULT_NOTE);
    expect(JSON.stringify(audit)).not.toContain('Nguyễn');
  });
  it('only writes the chosen second practice part', async () => {
    await service.reopen({ ...input, studentLessonId: 'sl-9', submissionId: 's9-p2', expectedCategory: 'PRACTICE_TASK2', expectedType: 'FILE_UPLOAD' }, actor, 'req-2');
    expect(mock.details.get('s9-p2')?.status).toBe('REDO');
    expect(mock.details.get('s9-p1')?.status).toBe('SUBMITTED');
  });
  it.each(['s8-quiz', 's8-p2', 's11-p1', 's11-p2', 's12-p1'])('blocks category or status for %s without a write', async id => {
    const lesson = mock.lessons.find(l => l.submissions.some(s => s.id === id))!;
    const write = vi.spyOn(mock, 'requestRedo');
    await expect(service.reopen({ ...input, studentLessonId: lesson.id, submissionId: id }, actor, 'req')).rejects.toMatchObject({ code: 'NOT_REOPENABLE' });
    expect(write).not.toHaveBeenCalled();
  });
  it.each([
    [{ enrollmentId: 'enroll-deleted' }, 'COURSE_NOT_FOUND'],
    [{ enrollmentId: 'enroll-python' }, 'LESSON_NOT_FOUND'],
    [{ studentLessonId: 'sl-old' }, 'LESSON_NOT_FOUND'],
    [{ studentLessonId: 'sl-7', submissionId: 's7-p1' }, 'LESSON_NOT_FOUND'],
    [{ studentLessonId: 'sl-13', submissionId: 's13-p1' }, 'LESSON_NOT_FOUND'],
    [{ submissionId: 's9-p1' }, 'SUBMISSION_NOT_FOUND'],
    [{ expectedCategory: 'PRACTICE_TASK2' }, 'STALE_SUBMISSION'],
    [{ expectedType: 'FILE_UPLOAD' }, 'STALE_SUBMISSION'],
    [{ expectedSubmittedCount: 0 }, 'STALE_SUBMISSION'],
  ])('rejects forged or stale selection %j', async (override, code) => {
    const write = vi.spyOn(mock, 'requestRedo');
    await expect(service.reopen({ ...input, ...override } as ReopenInput, actor, 'req')).rejects.toMatchObject({ code });
    expect(write).not.toHaveBeenCalled();
  });
  it('rejects changes after list load', async () => {
    mock.details.get('s8-p1')!.status = 'MARKED';
    const write = vi.spyOn(mock, 'requestRedo');
    await expect(service.reopen(input, actor, 'req')).rejects.toMatchObject({ code: 'STALE_SUBMISSION' });
    expect(write).not.toHaveBeenCalled();
  });
  it.each(['id', 'classId', 'lessonId'])('checks detail %s before writing', async key => {
    (mock.details.get('s8-p1')! as unknown as Record<string, unknown>)[key] = 'different';
    const write = vi.spyOn(mock, 'requestRedo');
    await expect(service.reopen(input, actor, 'req')).rejects.toMatchObject({ code: 'SUBMISSION_MISMATCH' });
    expect(write).not.toHaveBeenCalled();
  });
  it('checks permissions for reading and writing', async () => {
    await expect(service.search('26009543', { ...actor, canRead: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.reopen(input, { ...actor, canReopen: false }, 'req')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('blocks concurrent requests for the same submission', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = mock.requestRedo.bind(mock);
    const write = vi.spyOn(mock, 'requestRedo').mockImplementation(async (id, note) => { await gate; return original(id, note); });
    const first = service.reopen(input, actor, 'first');
    await expect(service.reopen(input, actor, 'second')).rejects.toMatchObject({ code: 'WRITE_IN_PROGRESS' });
    release(); await first;
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('does not trust mutation status without a successful read and never retries uncertain writes', async () => {
    const write = vi.spyOn(mock, 'requestRedo').mockResolvedValue({ id: 's8-p1', status: 'REDO', note: DEFAULT_NOTE });
    await expect(service.reopen(input, actor, 'req')).rejects.toMatchObject({ code: 'VERIFICATION_FAILED', uncertain: true });
    await expect(service.reopen(input, actor, 'req2')).rejects.toMatchObject({ code: 'WRITE_UNRESOLVED' });
    await expect(service.prepare('26009543', 'enroll-scratch', 'sl-8', 's8-p1', actor)).rejects.toMatchObject({ code: 'WRITE_UNRESOLVED' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(audit.at(-2)?.result).toBe('uncertain');
  });
  it('verifies REDO after mutation timeout without retrying mutation', async () => {
    const original = mock.requestRedo.bind(mock);
    const write = vi.spyOn(mock, 'requestRedo').mockImplementation(async (id, note) => { await original(id, note); throw new AppError(504, 'UPSTREAM_TIMEOUT', 'timeout', true); });
    const result = await service.reopen(input, actor, 'req');
    expect(result.verified).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(audit.at(-1)?.result).toBe('verified_after_error');
  });
  it('does not retry mutation when GraphQL failed and verification remains submitted', async () => {
    const write = vi.spyOn(mock, 'requestRedo').mockRejectedValue(new AppError(502, 'UPSTREAM_GRAPHQL', 'failure', true));
    await expect(service.reopen(input, actor, 'req')).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('requires identity to match even on post-mutation verification', async () => {
    vi.spyOn(mock, 'requestRedo').mockImplementation(async () => {
      mock.details.get('s8-p1')!.status = 'REDO'; mock.details.get('s8-p1')!.classId = 'other-class';
      return { id: 's8-p1', status: 'REDO', note: DEFAULT_NOTE };
    });
    await expect(service.reopen(input, actor, 'req')).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
  });
});
