import { createCrmLeadSummary } from "../../crm/models/crm-lead-summary.js";
import { createLmsStudentSummary } from "../../lms/models/lms-student-summary.js";
import type { PhoneSearchFixture } from "./phone-search.fixture.js";

/**
 * Synthetic edge cases where a shared search phone is not link evidence:
 * one Student has no LMS customer id and another has a similarly suffixed,
 * but different and system-namespaced, customer id.
 */
export const missingOrMismatchedLinksFixture = {
  searchPhone: "0000000005",
  response: {
    status: "success",
    sources: {
      crm: {
        status: "success",
        data: [
          createCrmLeadSummary({
            crmLeadId: "crm:lead:mock-051",
            crmCustomerId: "crm:customer:mock-shared-suffix-005",
            customerName: "Phụ huynh giả lập 05",
            status: "mock-crm-lead-status",
          }),
        ],
      },
      lms: {
        status: "success",
        data: [
          createLmsStudentSummary({
            lmsStudentId: "lms:student:mock-051",
            studentCode: "STUDENT-MOCK-051",
            fullName: "Học viên giả lập thiếu Customer ID",
            status: "mock-lms-student-status",
          }),
          createLmsStudentSummary({
            lmsStudentId: "lms:student:mock-052",
            studentCode: "STUDENT-MOCK-052",
            fullName: "Học viên giả lập ID không khớp",
            status: "mock-lms-student-status",
            lmsCustomerId: "lms:customer:mock-shared-suffix-005",
          }),
        ],
      },
    },
  },
} as const satisfies PhoneSearchFixture;
