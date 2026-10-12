import type { SearchSourceState } from "@mindx-360/contracts";
import { describe, expect, it } from "vitest";

import { MockCrmSearchClient } from "../src/modules/crm/clients/mock-crm-search-client.js";
import {
  createCrmLeadSummary,
  type CrmLeadSummary,
} from "../src/modules/crm/models/crm-lead-summary.js";

describe("MockCrmSearchClient", () => {
  const successPhone = "0000000061";
  const errorPhone = "0000000062";
  const lead = createCrmLeadSummary({ crmLeadId: "crm:lead:mock-061" });
  const scenarios = new Map<string, SearchSourceState<CrmLeadSummary>>([
    [successPhone, { status: "success", data: [lead] }],
    [
      errorPhone,
      {
        status: "unavailable",
        error: {
          code: "UNAVAILABLE",
          message: "Synthetic CRM outage",
          retryable: true,
          source: "crm",
        },
      },
    ],
  ]);

  it("returns every configured Lead on success", async () => {
    const client = new MockCrmSearchClient(scenarios);

    await expect(client.searchByPhone(successPhone)).resolves.toEqual({
      status: "success",
      data: [lead],
    });
  });

  it("returns empty for an unconfigured phone", async () => {
    const client = new MockCrmSearchClient(scenarios);

    await expect(client.searchByPhone("0000000060")).resolves.toEqual({
      status: "empty",
    });
  });

  it("returns the configured CRM error without calling an external API", async () => {
    const client = new MockCrmSearchClient(scenarios);

    await expect(client.searchByPhone(errorPhone)).resolves.toMatchObject({
      status: "unavailable",
      error: { source: "crm", code: "UNAVAILABLE" },
    });
  });
});
