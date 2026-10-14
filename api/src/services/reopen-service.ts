import type { Course, Lesson, ReopenInput, SubmissionDetail } from '../../../shared/contracts.js';
import { canReopen, eligibleLessons } from '../../../shared/rules.js';
import { assertRead, type Actor } from '../auth.js';
import type { Gateway } from '../clients/gateway.js';
import { type Config, realWritesConfigured } from '../config.js';
import { AppError } from '../errors.js';

export interface AuditEntry {
  at: string; actorId: string; requestId: string; submissionId: string;
  action: 'HOMEWORK_REOPEN'; result: 'started' | 'verified' | 'verified_after_error' | 'blocked' | 'uncertain' | 'failed'; code?: string;
}
export type AuditWriter = (entry: AuditEntry) => void;
export class ReopenService {
  private locks = new Set<string>();
  // Retain uncertain writes for this process. A read resolving REDO may clear them; never reissue uncertain writes.
  private uncertain = new Set<string>();
  constructor(private gateway: Gateway, private config: Config, private audit: AuditWriter = e => { process.stdout.write(`${JSON.stringify(e)}\n`); }) {}

  async findStudent(code: string, actor: Actor) {
    assertRead(actor);
    const page = await this.gateway.findStudents(code);
    if (page.pagination.total > page.data.length) throw new AppError(409, 'LMS_SEARCH_INCOMPLETE', 'Kết quả LMS chưa đầy đủ. Cần xác minh phân trang trước khi xác định học viên.');
    const matches = page.data.filter(student => student.studentId === code);
    if (!matches.length) throw new AppError(404, 'STUDENT_NOT_FOUND', 'Không tìm thấy học viên có mã LMS trùng chính xác.');
    if (matches.length !== 1) throw new AppError(409, 'STUDENT_AMBIGUOUS', 'Có nhiều học viên trùng mã LMS. Cần kiểm tra dữ liệu trước khi tiếp tục.');
    return matches[0]!;
  }
  async search(code: string, actor: Actor) {
    const student = await this.findStudent(code, actor);
    const courses = (await this.gateway.findCourses(student.id)).filter(c => !c.isDeleted);
    return { student, courses };
  }
  private async selectedCourse(code: string, enrollmentId: string, actor: Actor) {
    const { student, courses } = await this.search(code, actor);
    const matches = courses.filter(c => c.id === enrollmentId);
    if (matches.length !== 1) throw new AppError(404, 'COURSE_NOT_FOUND', 'Khóa học không thuộc học viên đã chọn hoặc dữ liệu ghi danh không duy nhất.');
    return { student, course: matches[0]! };
  }
  async lessons(code: string, enrollmentId: string, actor: Actor) {
    const { course } = await this.selectedCourse(code, enrollmentId, actor);
    const result = await this.gateway.findLessons(course.courseId, course.studentUid);
    if (result.course.id !== course.courseId) throw new AppError(409, 'COURSE_MISMATCH', 'API trả khóa học khác với khóa đã chọn.');
    return { ...result, lessons: eligibleLessons(result.lessons, course.classId) };
  }
  private async target(code: string, enrollmentId: string, studentLessonId: string, submissionId: string, actor: Actor) {
    const { student, course } = await this.selectedCourse(code, enrollmentId, actor);
    const result = await this.gateway.findLessons(course.courseId, course.studentUid);
    if (result.course.id !== course.courseId) throw new AppError(409, 'COURSE_MISMATCH', 'API trả khóa học khác với khóa đã chọn.');
    const matches = eligibleLessons(result.lessons, course.classId).filter(l => l.id === studentLessonId);
    if (matches.length !== 1) throw new AppError(404, 'LESSON_NOT_FOUND', 'Bài tập không thuộc lớp đã chọn hoặc là Checkpoint.');
    const lesson = matches[0]!;
    const parts = lesson.submissions.filter(s => s.id === submissionId);
    if (parts.length !== 1) throw new AppError(404, 'SUBMISSION_NOT_FOUND', 'Phần thực hành không thuộc bài tập đã chọn.');
    const submission = parts[0]!;
    const detail = await this.gateway.findSubmission(submissionId);
    this.assertIdentity(detail, submissionId, lesson, course);
    if (detail.category !== submission.category || detail.type !== submission.type || detail.status !== submission.status) throw new AppError(409, 'STALE_SUBMISSION', 'Dữ liệu bài nộp đã thay đổi. Hãy tải lại danh sách và kiểm tra.');
    return { student, course, lesson, submission, detail };
  }
  private assertIdentity(detail: SubmissionDetail | null, submissionId: string, lesson: Lesson, course: Course): asserts detail is SubmissionDetail {
    if (!detail || detail.id !== submissionId || detail.classId !== course.classId || detail.lessonId !== lesson.lessonId) throw new AppError(409, 'SUBMISSION_MISMATCH', 'Submission không khớp bài tập/lớp đã chọn. Cần kiểm tra ánh xạ ID.');
  }
  async prepare(code: string, enrollmentId: string, studentLessonId: string, submissionId: string, actor: Actor) {
    const target = await this.target(code, enrollmentId, studentLessonId, submissionId, actor);
    if (target.detail.status === 'REDO') this.uncertain.delete(submissionId);
    if (this.uncertain.has(submissionId)) throw new AppError(409, 'WRITE_UNRESOLVED', 'Thao tác trước chưa xác định được kết quả. Cần kiểm tra trực tiếp trên Denise trước khi thử ghi tiếp.', true);
    if (!canReopen(target.detail)) throw new AppError(409, 'NOT_REOPENABLE', 'Chỉ được mở lại phần thực hành đang Đã nộp. Hãy tải lại danh sách.');
    return target.detail;
  }
  async reopen(input: ReopenInput, actor: Actor, requestId: string) {
    const log = (result: AuditEntry['result'], code?: string) => this.audit({ at: new Date().toISOString(), actorId: actor.id, requestId, submissionId: input.submissionId, action: 'HOMEWORK_REOPEN', result, ...(code ? { code } : {}) });
    assertRead(actor);
    if (!actor.canReopen) { log('blocked', 'FORBIDDEN'); throw new AppError(403, 'FORBIDDEN', 'Không có quyền mở lại bài nộp.'); }
    if (this.config.API_MODE === 'real' && !realWritesConfigured(this.config)) { log('blocked', 'REAL_WRITE_DISABLED'); throw new AppError(403, 'REAL_WRITE_DISABLED', 'Mutation thật đang bị khóa. Chỉ bật sau khi được phép trên dữ liệu test.'); }
    if (this.locks.has(input.submissionId)) { log('blocked', 'WRITE_IN_PROGRESS'); throw new AppError(409, 'WRITE_IN_PROGRESS', 'Phần thực hành đang được xử lý. Vui lòng chờ kết quả.'); }
    if (this.uncertain.has(input.submissionId)) { log('blocked', 'WRITE_UNRESOLVED'); throw new AppError(409, 'WRITE_UNRESOLVED', 'Thao tác trước chưa xác định được kết quả. Không gửi lại yêu cầu ghi.', true); }
    this.locks.add(input.submissionId);
    let started = false;
    try {
      const target = await this.target(input.studentCode, input.enrollmentId, input.studentLessonId, input.submissionId, actor);
      if (this.config.API_MODE === 'real') {
        const studentAllowed = this.config.approvedStudents.length === 0 || this.config.approvedStudents.includes(target.student.id);
        const courseAllowed = this.config.approvedCourses.length === 0 || this.config.approvedCourses.includes(target.course.courseId);
        if (!studentAllowed || !courseAllowed) throw new AppError(403, 'TEST_DATA_NOT_APPROVED', 'Học viên hoặc khóa học không nằm trong danh sách dữ liệu test được duyệt.');
      }
      if (!canReopen(target.detail)) throw new AppError(409, 'NOT_REOPENABLE', 'Trạng thái hiện tại không cho phép mở lại. Hãy tải lại danh sách.');
      if (target.detail.category !== input.expectedCategory || target.detail.type !== input.expectedType || target.detail.submittedCount !== input.expectedSubmittedCount) throw new AppError(409, 'STALE_SUBMISSION', 'Bài nộp đã thay đổi từ lúc xác nhận. Hãy tải lại dữ liệu.');
      log('started');
      started = true;
      let mutationError: unknown;
      let mutationMismatch = false;
      try {
        const result = await this.gateway.requestRedo(input.submissionId, input.note);
        mutationMismatch = result.id !== input.submissionId;
      } catch (error) { mutationError = error; }
      // Always perform a read after the single attempted write, even after timeout/GraphQL errors.
      try {
        const verified = await this.gateway.findSubmission(input.submissionId);
        this.assertIdentity(verified, input.submissionId, target.lesson, target.course);
        if (mutationMismatch || verified.category !== target.detail.category || verified.type !== target.detail.type || verified.status !== 'REDO') throw new AppError(409, 'VERIFICATION_FAILED', 'Chưa xác minh được phần thực hành đã chuyển sang REDO.', true);
        log(mutationError ? 'verified_after_error' : 'verified');
        return { verified: true as const, submission: verified, message: mutationError ? 'Đã đọc lại và xác minh REDO sau lỗi phản hồi. Phần thực hành đã được mở lại.' : 'Đã mở lại phần thực hành và xác minh trạng thái REDO.' };
      } catch {
        this.uncertain.add(input.submissionId);
        throw new AppError(409, 'VERIFICATION_FAILED', 'Chưa xác định được kết quả mở lại. Không gửi lại thao tác; hãy tải lại và kiểm tra trên Denise.', true);
      }
    } catch (error) {
      log(started ? 'uncertain' : 'blocked', error instanceof AppError ? error.code : 'INTERNAL_ERROR');
      throw error;
    } finally { this.locks.delete(input.submissionId); }
  }
}
