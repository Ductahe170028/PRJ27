import type { SearchSourceState } from "@mindx-360/contracts";

import type { CrmLeadSummary } from "../models/crm-lead-summary.js";

export interface CrmSearchClient {
  searchByPhone(phone: string): Promise<SearchSourceState<CrmLeadSummary>>;
}
