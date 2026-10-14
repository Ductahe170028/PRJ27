import { describe, expect, it } from 'vitest';
import { canReopen, eligibleLessons } from '../../shared/rules.js';
import { MockGateway } from '../src/clients/mock-gateway.js';

describe('Homework Reopen rules', () => {
  it.each(['PRACTICE_TASK1', 'PRACTICE_TASK2'])('allows submitted %s', category => {
    expect(canReopen({ category, status: 'SUBMITTED' })).toBe(true);
  });
  it.each(['IN_PROGRESS', 'REDO', 'RE_SUBMITTED', 'MARKED', 'UNKNOWN'])('blocks practice status %s', status => {
    expect(canReopen({ category: 'PRACTICE_TASK1', status })).toBe(false);
  });
  it.each(['QUIZ', 'OTHER'])('blocks submitted %s', category => {
    expect(canReopen({ category, status: 'SUBMITTED' })).toBe(false);
  });
  it('filters class and both checkpoint fields without splitting homework submissions', () => {
    const mock = new MockGateway();
    const lessons = eligibleLessons(mock.lessons.reverse(), 'HN-SCR-2408');
    expect(lessons.map(l => l.sessionNumber)).toEqual([8, 9, 10, 11, 12]);
    expect(lessons[0]?.submissions).toHaveLength(3);
    expect(lessons[1]?.submissions).toHaveLength(2);
    expect(eligibleLessons(mock.lessons, 'HN-SCR-2306')).toHaveLength(1);
  });
  it('uses displayOrder when sessionNumber is absent', () => {
    const mock = new MockGateway();
    mock.lessons[0]!.sessionNumber = null;
    mock.lessons[0]!.displayOrder = 14;
    expect(eligibleLessons(mock.lessons, 'HN-SCR-2408').at(-1)?.id).toBe('sl-8');
  });
});
