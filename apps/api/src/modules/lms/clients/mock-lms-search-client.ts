import type { SearchSourceState } from "@mindx-360/contracts";

import type { LmsStudentSummary } from "../models/lms-student-summary.js";
import type { LmsSearchClient } from "./lms-search-client.js";

export type MockLmsSearchScenarios = ReadonlyMap<
  string,
  SearchSourceState<LmsStudentSummary>
>;

export class MockLmsSearchClient implements LmsSearchClient {
  readonly #scenarios: MockLmsSearchScenarios;

  public constructor(scenarios: MockLmsSearchScenarios = new Map()) {
    this.#scenarios = new Map(scenarios);
  }

  public async searchByPhone(
    phone: string,
  ): Promise<SearchSourceState<LmsStudentSummary>> {
    return this.#scenarios.get(phone) ?? { status: "empty" };
  }
}
