import { z } from 'zod';
import { courseSchema, lessonResultSchema, studentSchema, submissionDetailSchema } from '../../../shared/contracts.js';
import type { Config } from '../config.js';
import { AppError } from '../errors.js';
import { GraphqlClient } from './graphql.js';
import type { Gateway } from './gateway.js';
import { FIND_COURSES, FIND_LESSONS, FIND_LMS_STUDENT, FIND_SUBMISSION, REQUEST_REDO } from './documents.js';

export class RealGateway implements Gateway {
  private lms: GraphqlClient;
  private denise: GraphqlClient;
  constructor(config: Config, fetcher?: typeof fetch) {
    this.lms = new GraphqlClient({ url: config.LMS_GRAPHQL_URL, authHeader: config.LMS_AUTH_HEADER, authValue: config.LMS_AUTH_VALUE, timeoutMs: config.UPSTREAM_TIMEOUT_MS }, fetcher);
    this.denise = new GraphqlClient({ url: config.DENISE_GRAPHQL_URL, authHeader: config.DENISE_AUTH_HEADER, authValue: config.DENISE_AUTH_VALUE, timeoutMs: config.UPSTREAM_TIMEOUT_MS }, fetcher);
  }
  async findStudents(code: string) {
    const result = await this.lms.execute(FIND_LMS_STUDENT, { p: { filter_textSearch: code, itemsPerPage: 5 } }, z.object({ students: z.object({ data: z.array(studentSchema), pagination: z.object({ total: z.number().int().nonnegative() }) }) }));
    // No invented page field. Incomplete results must be resolved after schema verification.
    if (result.students.pagination.total > result.students.data.length) throw new AppError(409, 'LMS_SEARCH_INCOMPLETE', 'Kết quả LMS còn phân trang. Chưa thể xác định duy nhất học viên; cần xác minh cơ chế phân trang API.');
    return result.students;
  }
  async findCourses(lmsId: string) {
    return (await this.denise.execute(FIND_COURSES, { in: { studentServiceId: lmsId, isDeleted: false } }, z.object({ StudentCourse_findAll: z.array(courseSchema) }))).StudentCourse_findAll;
  }
  async findLessons(courseId: string, studentUid: string) {
    return (await this.denise.execute(FIND_LESSONS, { p: { courseId, studentId: studentUid } }, z.object({ StudentLesson_find: lessonResultSchema }))).StudentLesson_find;
  }
  async findSubmission(id: string) {
    return (await this.denise.execute(FIND_SUBMISSION, { id }, z.object({ StudentSubmission_findById: submissionDetailSchema.nullable() }))).StudentSubmission_findById;
  }
  async requestRedo(id: string, note: string) {
    return (await this.denise.execute(REQUEST_REDO, { payload: { id, note } }, z.object({ StudentSubmission_requestRedoSubmission: z.object({ id: z.string().min(1), status: z.string().min(1), note: z.string().nullish() }) }), true)).StudentSubmission_requestRedoSubmission;
  }
}
