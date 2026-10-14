import type { Lesson, Submission } from './contracts.js';

export function isPractice(category: string): category is 'PRACTICE_TASK1' | 'PRACTICE_TASK2' {
  return category === 'PRACTICE_TASK1' || category === 'PRACTICE_TASK2';
}
export function canReopen(submission: Pick<Submission, 'category' | 'status'>): boolean {
  return isPractice(submission.category) && submission.status === 'SUBMITTED';
}
export function blockedReason(submission: Pick<Submission, 'category' | 'status'>): string {
  if (!isPractice(submission.category)) return 'Phần này không thuộc phạm vi mở lại.';
  switch (submission.status) {
    case 'SUBMITTED': return '';
    case 'IN_PROGRESS': return 'Phần thực hành chưa được nộp.';
    case 'REDO': return 'Phần này đã được yêu cầu làm lại.';
    case 'RE_SUBMITTED': return 'Bài đã nộp lại chưa được hỗ trợ ở V1.';
    case 'MARKED': return 'Bài đã chấm chưa được hỗ trợ ở V1.';
    default: return 'Trạng thái này chưa được hỗ trợ ở V1.';
  }
}
export function eligibleLessons(lessons: Lesson[], classId: string): Lesson[] {
  return lessons
    .filter(item => item.classId === classId && item.type !== 'CHECKPOINT' && item.lesson.type !== 'CHECKPOINT')
    .sort((a, b) => (a.sessionNumber ?? a.displayOrder ?? Number.MAX_SAFE_INTEGER) - (b.sessionNumber ?? b.displayOrder ?? Number.MAX_SAFE_INTEGER));
}
export function statusLabel(status: string): string {
  return ({ SUBMITTED: 'Đã nộp', IN_PROGRESS: 'Chưa nộp', REDO: 'Yêu cầu làm lại', RE_SUBMITTED: 'Đã nộp lại', MARKED: 'Đã chấm', COMPLETED: 'Hoàn thành' } as Record<string, string>)[status] ?? 'Chưa hỗ trợ';
}
export function categoryLabel(category: string): string {
  return ({ PRACTICE_TASK1: 'Thực hành 1', PRACTICE_TASK2: 'Thực hành 2', QUIZ: 'Trắc nghiệm' } as Record<string, string>)[category] ?? 'Phần khác';
}
