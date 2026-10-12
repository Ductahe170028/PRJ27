import type { SearchSourceState } from "@mindx-360/contracts";

import type { LmsStudentSummary } from "../models/lms-student-summary.js";

export interface LmsSearchClient {
  searchByPhone(phone: string): Promise<SearchSourceState<LmsStudentSummary>>;
}
