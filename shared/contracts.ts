import { z } from 'zod';

export const idSchema = z.string().trim().min(1).max(200);
export const studentCodeSchema = z.string().trim().regex(/^\d{1,20}$/, 'Mã học viên phải gồm 1–20 chữ số.');
export const studentSchema = z.object({ id: idSchema, fullName: z.string().min(1), studentId: z.string().min(1) });
export const courseSchema = z.object({
  id: idSchema,
  studentUid: idSchema,
  courseId: idSchema,
  classId: idSchema,
  status: z.string().min(1),
  courseVersionId: z.string().nullish(),
  isDeleted: z.boolean(),
  course: z.object({ id: idSchema, name: z.string().min(1), code: z.string().nullish(), operationCourses: z.unknown().optional() }),
});
export const submissionSchema = z.object({
  id: idSchema,
  category: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1),
  score: z.number().nullish(),
  note: z.string().nullish(),
});
export const lessonSchema = z.object({
  id: idSchema,
  lessonId: idSchema,
  classId: idSchema,
  sessionNumber: z.number().nullish(),
  displayOrder: z.number().nullish(),
  availableAt: z.string().nullish(),
  status: z.string().min(1),
  type: z.string().min(1),
  lesson: z.object({ id: idSchema, name: z.string().min(1), type: z.string().min(1) }),
  submissions: z.array(submissionSchema),
});
export const lessonResultSchema = z.object({
  course: z.object({ id: idSchema, name: z.string().min(1) }),
  classes: z.array(z.object({ classId: idSchema, className: z.string().min(1) })),
  lessons: z.array(lessonSchema),
});
export const submissionDetailSchema = z.object({
  id: idSchema,
  status: z.string().min(1),
  category: z.string().min(1),
  type: z.string().min(1),
  submittedCount: z.number().int().nonnegative(),
  classId: idSchema,
  lessonId: idSchema,
});
export const reopenInputSchema = z.object({
  studentCode: studentCodeSchema,
  enrollmentId: idSchema,
  studentLessonId: idSchema,
  submissionId: idSchema,
  expectedCategory: z.enum(['PRACTICE_TASK1', 'PRACTICE_TASK2']),
  expectedType: z.string().min(1).max(100),
  expectedSubmittedCount: z.number().int().nonnegative(),
  note: z.string().trim().min(1, 'Vui lòng nhập lý do mở lại.').max(1000, 'Lý do tối đa 1.000 ký tự.'),
}).strict();
export const metaSchema = z.object({
  mode: z.enum(['mock', 'real']),
  canReopen: z.boolean(),
  actorName: z.string(),
  notice: z.string(),
});
export const searchResultSchema = z.object({ student: studentSchema, courses: z.array(courseSchema) });
export const reopenResultSchema = z.object({
  verified: z.literal(true),
  submission: submissionDetailSchema,
  message: z.string(),
});
export const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional(), uncertain: z.boolean().optional() }),
});
export type Student = z.infer<typeof studentSchema>;
export type Course = z.infer<typeof courseSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
export type Submission = z.infer<typeof submissionSchema>;
export type SubmissionDetail = z.infer<typeof submissionDetailSchema>;
export type LessonResult = z.infer<typeof lessonResultSchema>;
export type ReopenInput = z.infer<typeof reopenInputSchema>;
export type Meta = z.infer<typeof metaSchema>;

export const DEFAULT_NOTE = 'Mở lại do học viên lỡ nộp bài khi chưa hoàn thành';
export const FILE_WARNING = 'File cũ có thể không xuất hiện lại trên form. Lần nộp tiếp theo có thể thay thế danh sách file; học viên cần đính kèm lại tất cả file muốn giữ.';
