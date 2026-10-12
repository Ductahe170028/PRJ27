import {
  optionalNonBlankString,
  requireNonBlankString,
} from "../../../shared/model-validation.js";

/**
 * Minimal LMS Student information needed by the phone-search result.
 *
 * lmsStudentId represents the internal LMS id returned by getStudents.
 * studentCode represents the separate display code exposed as studentId by
 * findStudentById and may be unavailable in the initial list response.
 * Raw status values are preserved without enum interpretation.
 */
export interface LmsStudentSummary {
  readonly lmsStudentId: string;
  readonly studentCode: string | null;
  readonly fullName: string | null;
  readonly status: string | null;
  readonly lmsCustomerId: string | null;
}

export interface LmsStudentSummaryInput {
  readonly lmsStudentId?: unknown;
  readonly studentCode?: unknown;
  readonly fullName?: unknown;
  readonly status?: unknown;
  readonly lmsCustomerId?: unknown;
}

export function createLmsStudentSummary(
  input: LmsStudentSummaryInput,
): LmsStudentSummary {
  return {
    lmsStudentId: requireNonBlankString(input.lmsStudentId, "lmsStudentId"),
    studentCode: optionalNonBlankString(input.studentCode, "studentCode"),
    fullName: optionalNonBlankString(input.fullName, "fullName"),
    status: optionalNonBlankString(input.status, "status"),
    lmsCustomerId: optionalNonBlankString(
      input.lmsCustomerId,
      "lmsCustomerId",
    ),
  };
}
