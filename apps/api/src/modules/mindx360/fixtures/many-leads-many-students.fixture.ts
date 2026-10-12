import { createCrmLeadSummary } from "../../crm/models/crm-lead-summary.js";
import { createLmsStudentSummary } from "../../lms/models/lms-student-summary.js";
import type { PhoneSearchFixture } from "./phone-search.fixture.js";

/**
 * Fully synthetic fixture proving that one search keeps every CRM/LMS result.
 * Same-system customer ids are shared within each source, while CRM and LMS
 * identifiers remain separate and do not establish a cross-system link.
 */
export const manyLeadsManyStudentsFixture = {
  searchPhone: "0000000004",
  response: {
    status: "success",
    sources: {
      crm: {
        status: "success",
        data: [
          createCrmLeadSummary({
            crmLeadId: "crm:lead:mock-041",
            crmCustomerId: "crm:customer:mock-parent-004",
            customerName: "Phụ huynh giả lập 04",
            status: "mock-crm-lead-status-a",
            businessUnitId: "crm:business-unit:mock-001",
            ownerName: "Tư vấn viên giả lập A",
          }),
          createCrmLeadSummary({
            crmLeadId: "crm:lead:mock-042",
            crmCustomerId: "crm:customer:mock-parent-004",
            customerName: "Phụ huynh giả lập 04",
            status: "mock-crm-lead-status-b",
            businessUnitId: "crm:business-unit:mock-002",
            ownerName: "Tư vấn viên giả lập B",
          }),
        ],
      },
      lms: {
        status: "success",
        data: [
          createLmsStudentSummary({
            lmsStudentId: "lms:student:mock-041",
            studentCode: "STUDENT-MOCK-041",
            fullName: "Học viên giả lập 04A",
            status: "mock-lms-student-status-a",
            lmsCustomerId: "lms:customer:mock-parent-004",
          }),
          createLmsStudentSummary({
            lmsStudentId: "lms:student:mock-042",
            studentCode: "STUDENT-MOCK-042",
            fullName: "Học viên giả lập 04B",
            status: "mock-lms-student-status-b",
            lmsCustomerId: "lms:customer:mock-parent-004",
          }),
        ],
      },
    },
  },
} as const satisfies PhoneSearchFixture;
