import type { SearchResponse } from "@mindx-360/contracts";

import type { CrmLeadSummary } from "../../crm/models/crm-lead-summary.js";
import type { LmsStudentSummary } from "../../lms/models/lms-student-summary.js";

export interface PhoneSearchFixture {
  readonly searchPhone: string;
  readonly response: SearchResponse<CrmLeadSummary, LmsStudentSummary>;
}
