import type { SearchSourceState } from "@mindx-360/contracts";
import { describe, expect, it } from "vitest";

import { MockLmsSearchClient } from "../src/modules/lms/clients/mock-lms-search-client.js";
import {
  createLmsStudentSummary,
  type LmsStudentSummary,
} from "../src/modules/lms/models/lms-student-summary.js";

describe("MockLmsSearchClient", () => {
  const successPhone = "0000000061";
  const errorPhone = "0000000062";
  const student = createLmsStudentSummary({
    lmsStudentId: "lms:student:mock-061",
  });
  const scenarios = new Map<string, SearchSourceState<LmsStudentSummary>>([
    [successPhone, { status: "success", data: [student] }],
    [
      errorPhone,
      {
        status: "forbidden",
        error: {
          code: "FORBIDDEN",
          message: "Synthetic LMS permission error",
          retryable: false,
          source: "lms",
        },
      },
    ],
  ]);

  it("returns every configured Student on success", async () => {
    const client = new MockLmsSearchClient(scenarios);

    await expect(client.searchByPhone(successPhone)).resolves.toEqual({
      status: "success",
      data: [student],
    });
  });

  it("returns empty for an unconfigured phone", async () => {
    const client = new MockLmsSearchClient(scenarios);

    await expect(client.searchByPhone("0000000060")).resolves.toEqual({
      status: "empty",
    });
  });

  it("returns the configured LMS error without calling an external API", async () => {
    const client = new MockLmsSearchClient(scenarios);

    await expect(client.searchByPhone(errorPhone)).resolves.toMatchObject({
      status: "forbidden",
      error: { source: "lms", code: "FORBIDDEN" },
    });
  });
});
