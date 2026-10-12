import type {
  ApiError,
  DataSource,
  SearchResponse,
  SearchResponseStatus,
  SearchSourceState,
} from "@mindx-360/contracts";

import type { CrmSearchClient } from "../../crm/clients/crm-search-client.js";
import type { CrmLeadSummary } from "../../crm/models/crm-lead-summary.js";
import type { LmsSearchClient } from "../../lms/clients/lms-search-client.js";
import type { LmsStudentSummary } from "../../lms/models/lms-student-summary.js";

export type SearchByPhoneResult = SearchResponse<
  CrmLeadSummary,
  LmsStudentSummary
>;

export interface SearchByPhoneUseCase {
  searchByPhone(phone: string): Promise<SearchByPhoneResult>;
}

const failureStatuses = new Set(["forbidden", "unavailable", "error"]);

function isFailure<TItem>(state: SearchSourceState<TItem>): boolean {
  return failureStatuses.has(state.status);
}

function resolveOverallStatus(
  crm: SearchSourceState<CrmLeadSummary>,
  lms: SearchSourceState<LmsStudentSummary>,
): SearchResponseStatus {
  if (crm.status === "partial" || lms.status === "partial") {
    return "partial";
  }

  const crmFailed = isFailure(crm);
  const lmsFailed = isFailure(lms);
  if (crmFailed && lmsFailed) {
    return "error";
  }
  if (crmFailed || lmsFailed) {
    return "partial";
  }
  if (crm.status === "empty" && lms.status === "empty") {
    return "empty";
  }

  return "success";
}

function unexpectedClientError(source: DataSource): ApiError {
  return {
    code: "UNKNOWN",
    message: `${source.toUpperCase()} search failed unexpectedly`,
    retryable: false,
    source,
  };
}

export class SearchByPhoneService implements SearchByPhoneUseCase {
  public constructor(
    private readonly crmClient: CrmSearchClient,
    private readonly lmsClient: LmsSearchClient,
  ) {}

  public async searchByPhone(phone: string): Promise<SearchByPhoneResult> {
    const [crm, lms] = await Promise.all([
      this.searchCrmSafely(phone),
      this.searchLmsSafely(phone),
    ]);

    return {
      status: resolveOverallStatus(crm, lms),
      sources: { crm, lms },
    };
  }

  private async searchCrmSafely(
    phone: string,
  ): Promise<SearchSourceState<CrmLeadSummary>> {
    try {
      return await this.crmClient.searchByPhone(phone);
    } catch {
      return { status: "error", error: unexpectedClientError("crm") };
    }
  }

  private async searchLmsSafely(
    phone: string,
  ): Promise<SearchSourceState<LmsStudentSummary>> {
    try {
      return await this.lmsClient.searchByPhone(phone);
    } catch {
      return { status: "error", error: unexpectedClientError("lms") };
    }
  }
}
