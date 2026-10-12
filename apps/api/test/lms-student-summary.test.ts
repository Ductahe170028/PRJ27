import { describe, expect, it } from "vitest";

import { createLmsStudentSummary } from "../src/modules/lms/models/lms-student-summary.js";

describe("createLmsStudentSummary", () => {
  it("keeps the LMS internal id separate from the display code", () => {
    expect(
      createLmsStudentSummary({
        lmsStudentId: "lms-internal-1",
        studentCode: "display-code-1",
        fullName: "Student One",
        status: "raw-student-status",
        lmsCustomerId: "lms-customer-1",
      }),
    ).toEqual({
      lmsStudentId: "lms-internal-1",
      studentCode: "display-code-1",
      fullName: "Student One",
      status: "raw-student-status",
      lmsCustomerId: "lms-customer-1",
    });
  });

  it("allows the list response to omit detail-only and optional fields", () => {
    expect(createLmsStudentSummary({ lmsStudentId: "lms-internal-1" })).toEqual(
      {
        lmsStudentId: "lms-internal-1",
        studentCode: null,
        fullName: null,
        status: null,
        lmsCustomerId: null,
      },
    );
  });

  it.each([
    [{}, "lmsStudentId"],
    [{ lmsStudentId: "" }, "lmsStudentId"],
    [{ lmsStudentId: "lms-internal-1", fullName: false }, "fullName"],
  ])("rejects invalid data %#", (input, fieldName) => {
    expect(() => createLmsStudentSummary(input)).toThrow(
      `${fieldName} must be a non-empty string`,
    );
  });

  it("does not constrain a search to one Student", () => {
    const students = ["lms-internal-1", "lms-internal-2"].map(
      (lmsStudentId) => createLmsStudentSummary({ lmsStudentId }),
    );

    expect(students.map(({ lmsStudentId }) => lmsStudentId)).toEqual([
      "lms-internal-1",
      "lms-internal-2",
    ]);
  });
});
