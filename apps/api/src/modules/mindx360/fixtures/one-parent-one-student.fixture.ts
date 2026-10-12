import type { SearchResponse } from "@mindx-360/contracts";

import {
  createCrmLeadSummary,
  type CrmLeadSummary,
} from "../../crm/models/crm-lead-summary.js";
import {
  createLmsStudentSummary,
  type LmsStudentSummary,
} from "../../lms/models/lms-student-summary.js";

export interface PhoneSearchFixture {
  readonly searchPhone: string;
  readonly response: SearchResponse<CrmLeadSummary, LmsStudentSummary>;
}

/**
 * Fully synthetic happy-path fixture for one phone search.
 *
 * CRM and LMS results share only the search input. Their customer identifiers
 * are deliberately distinct, and this fixture declares no cross-system link.
 */
export const oneParentOneStudentFixture = {
  searchPhone: "0000000000",
  response: {
    status: "success",
    sources: {
      crm: {
        status: "success",
        data: [
          createCrmLeadSummary({
            crmLeadId: "crm:lead:mock-001",
            crmCustomerId: "crm:customer:mock-parent-001",
            customerName: "Phụ huynh giả lập 01",
            status: "mock-crm-lead-status",
            businessUnitId: "crm:business-unit:mock-001",
            ownerName: "Tư vấn viên giả lập 01",
          }),
        ],
      },
      lms: {
        status: "success",
        data: [
          createLmsStudentSummary({
            lmsStudentId: "lms:student:mock-001",
            studentCode: "STUDENT-MOCK-001",
            fullName: "Học viên giả lập 01",
            status: "mock-lms-student-status",
            lmsCustomerId: "lms:customer:mock-parent-001",
          }),
        ],
      },
    },
  },
} as const satisfies PhoneSearchFixture;
