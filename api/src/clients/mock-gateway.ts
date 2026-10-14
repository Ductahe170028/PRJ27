import type { Course, Lesson, LessonResult, Student, Submission, SubmissionDetail } from '../../../shared/contracts.js';
import { AppError } from '../errors.js';
import type { Gateway, StudentPage } from './gateway.js';

function enrollment(id: string, courseId: string, classId: string, name: string, status = 'IN_PROGRESS', studentUid = 'base-an'): Course {
  return { id, studentUid, courseId, classId, status, courseVersionId: 'v1', isDeleted: false, course: { id: courseId, name, code: courseId === 'scratch-2' ? 'SCR-02' : 'PY-01' } };
}
function part(id: string, category: string, status: string, type = 'SCRATCH'): Submission {
  return { id, category, status, type, score: null, note: null };
}
function homework(session: number, name: string, submissions: Submission[], overrides: Partial<Lesson> = {}): Lesson {
  return { id: `sl-${session}`, lessonId: `lesson-${session}`, classId: 'HN-SCR-2408', sessionNumber: session, displayOrder: session, availableAt: '2026-10-10T02:00:00.000Z', status: submissions.some(s => s.status === 'IN_PROGRESS') ? 'IN_PROGRESS' : 'COMPLETED', type: 'HOMEWORK', lesson: { id: `lesson-${session}`, name, type: 'HOMEWORK' }, submissions, ...overrides };
}

export class MockGateway implements Gateway {
  readonly students: Student[] = [
    { id: 'lms-near', studentId: '260095430', fullName: 'Nguyễn Minh Anh' },
    { id: 'lms-an', studentId: '26009543', fullName: 'Nguyễn Hoàng An' },
    { id: 'lms-no-denise', studentId: '26000001', fullName: 'Trần Bảo Ngọc' },
    { id: 'lms-no-courses', studentId: '26000002', fullName: 'Lê Minh Khang' },
    { id: 'lms-dupe-1', studentId: '26000003', fullName: 'Học viên trùng mã A' },
    { id: 'lms-dupe-2', studentId: '26000003', fullName: 'Học viên trùng mã B' },
    { id: 'lms-no-lessons', studentId: '26000004', fullName: 'Phạm Gia Hân' },
  ];
  readonly courses: Record<string, Course[]> = {
    'lms-an': [
      enrollment('enroll-scratch', 'scratch-2', 'HN-SCR-2408', 'Lập trình Scratch nâng cao'),
      enrollment('enroll-scratch-old', 'scratch-2', 'HN-SCR-2306', 'Lập trình Scratch nâng cao', 'COMPLETED'),
      enrollment('enroll-python', 'python-1', 'HN-PY-2410', 'Khởi đầu với Python', 'COMPLETED'),
      { ...enrollment('enroll-deleted', 'deleted-course', 'old-class', 'Khóa đã xóa'), isDeleted: true },
    ],
    'lms-no-courses': [],
    'lms-no-lessons': [enrollment('enroll-empty', 'empty-course', 'empty-class', 'Khóa học mới', 'IN_PROGRESS', 'base-han')],
  };
  readonly lessons: Lesson[] = [
    homework(8, 'Thiết kế trò chơi mê cung', [part('s8-quiz', 'QUIZ', 'MARKED', 'QUIZ'), part('s8-p1', 'PRACTICE_TASK1', 'SUBMITTED'), part('s8-p2', 'PRACTICE_TASK2', 'IN_PROGRESS')]),
    homework(9, 'Kể chuyện cùng nhân vật', [part('s9-p1', 'PRACTICE_TASK1', 'SUBMITTED'), part('s9-p2', 'PRACTICE_TASK2', 'SUBMITTED', 'FILE_UPLOAD')]),
    homework(10, 'Xây dựng thế giới của em', [part('s10-p1', 'PRACTICE_TASK1', 'SUBMITTED', 'FILE_UPLOAD')]),
    homework(11, 'Thử thách lập trình sáng tạo', [part('s11-p1', 'PRACTICE_TASK1', 'REDO'), part('s11-p2', 'PRACTICE_TASK2', 'RE_SUBMITTED')]),
    homework(12, 'Dự án cuối khóa', [part('s12-quiz', 'QUIZ', 'IN_PROGRESS', 'QUIZ'), part('s12-p1', 'PRACTICE_TASK1', 'MARKED'), part('s12-p2', 'PRACTICE_TASK2', 'IN_PROGRESS')]),
    homework(6, 'Bài tập thuộc lớp khác', [part('s6-p1', 'PRACTICE_TASK1', 'SUBMITTED')], { id: 'sl-old', classId: 'HN-SCR-2306' }),
    homework(7, 'Checkpoint giữa khóa', [part('s7-p1', 'PRACTICE_TASK1', 'SUBMITTED')], { type: 'CHECKPOINT' }),
    homework(13, 'Checkpoint cuối khóa', [part('s13-p1', 'PRACTICE_TASK1', 'SUBMITTED')], { lesson: { id: 'lesson-13', name: 'Checkpoint cuối khóa', type: 'CHECKPOINT' } }),
  ];
  readonly details = new Map<string, SubmissionDetail>();
  constructor() {
    for (const lesson of this.lessons) for (const submission of lesson.submissions) {
      this.details.set(submission.id, { id: submission.id, category: submission.category, type: submission.type, status: submission.status, submittedCount: 1, lessonId: lesson.lessonId, classId: lesson.classId });
    }
  }
  async findStudents(code: string): Promise<StudentPage> {
    if (code === '26000005') return { data: [structuredClone(this.students[1]!)], pagination: { total: 6 } };
    const data = this.students.filter(s => s.studentId.includes(code));
    return structuredClone({ data, pagination: { total: data.length } });
  }
  async findCourses(lmsId: string): Promise<Course[]> {
    if (lmsId === 'lms-no-denise') throw new AppError(404, 'DENISE_STUDENT_NOT_FOUND', 'Học viên chưa có tài khoản Denise.');
    return structuredClone(this.courses[lmsId] ?? []);
  }
  async findLessons(courseId: string, studentUid: string): Promise<LessonResult> {
    const lessons = courseId === 'scratch-2' && studentUid === 'base-an' ? this.lessons : [];
    return structuredClone({ course: { id: courseId, name: courseId === 'scratch-2' ? 'Lập trình Scratch nâng cao' : 'Khóa học Denise' }, classes: [{ classId: 'HN-SCR-2408', className: 'HN · Scratch · 2408' }, { classId: 'HN-SCR-2306', className: 'HN · Scratch · 2306' }], lessons });
  }
  async findSubmission(id: string): Promise<SubmissionDetail | null> { return structuredClone(this.details.get(id) ?? null); }
  async requestRedo(id: string, note: string) {
    const detail = this.details.get(id);
    if (!detail) throw new AppError(404, 'SUBMISSION_NOT_FOUND', 'Không tìm thấy phần thực hành.');
    detail.status = 'REDO';
    for (const lesson of this.lessons) {
      const submission = lesson.submissions.find(s => s.id === id);
      if (submission) { submission.status = 'REDO'; submission.note = note; }
    }
    // StudentLesson.status stays as supplied; no claim about real Denise lesson transitions.
    return { id, status: detail.status, note };
  }
}
