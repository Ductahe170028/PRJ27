import type { Course, LessonResult, Student, SubmissionDetail } from '../../../shared/contracts.js';

export interface StudentPage { data: Student[]; pagination: { total: number } }
export interface Gateway {
  findStudents(code: string): Promise<StudentPage>;
  findCourses(lmsId: string): Promise<Course[]>;
  findLessons(courseId: string, studentUid: string): Promise<LessonResult>;
  findSubmission(id: string): Promise<SubmissionDetail | null>;
  requestRedo(id: string, note: string): Promise<{ id: string; status: string; note?: string | null }>;
}
