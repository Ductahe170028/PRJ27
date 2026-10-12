import type { SearchSourceState } from "@mindx-360/contracts";

import type { CrmLeadSummary } from "../models/crm-lead-summary.js";
import type { CrmSearchClient } from "./crm-search-client.js";

export type MockCrmSearchScenarios = ReadonlyMap<
  string,
  SearchSourceState<CrmLeadSummary>
>;

export class MockCrmSearchClient implements CrmSearchClient {
  readonly #scenarios: MockCrmSearchScenarios;

  public constructor(scenarios: MockCrmSearchScenarios = new Map()) {
    this.#scenarios = new Map(scenarios);
  }

  public async searchByPhone(
    phone: string,
  ): Promise<SearchSourceState<CrmLeadSummary>> {
    return this.#scenarios.get(phone) ?? { status: "empty" };
  }
}
