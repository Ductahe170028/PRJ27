import type { SearchResponse } from "@mindx-360/contracts";
import { describe, expect, it } from "vitest";

import type { CrmLeadSummary } from "../src/modules/crm/models/crm-lead-summary.js";
import {
  createLmsStudentSummary,
  type LmsStudentSummary,
} from "../src/modules/lms/models/lms-student-summary.js";
import { missingOrMismatchedLinksFixture } from "../src/modules/mindx360/fixtures/missing-or-mismatched-links.fixture.js";

describe("missingOrMismatchedLinksFixture", () => {
  const response: SearchResponse<CrmLeadSummary, LmsStudentSummary> =
    missingOrMismatchedLinksFixture.response;

  it("represents missing and mismatched Student link identifiers", () => {
    const crmState = response.sources.crm;
    const lmsState = response.sources.lms;
    if (crmState.status !== "success" || lmsState.status !== "success") {
      throw new Error("Expected successful fixture states");
    }

    expect(missingOrMismatchedLinksFixture.searchPhone).toBe("0000000005");
    expect(crmState.data).toHaveLength(1);
    expect(lmsState.data).toHaveLength(2);

    const studentsById = new Map(
      lmsState.data.map((student) => [student.lmsStudentId, student]),
    );
    expect(studentsById.get("lms:student:mock-051")?.lmsCustomerId).toBeNull();
    expect(studentsById.get("lms:student:mock-052")?.lmsCustomerId).toBe(
      "lms:customer:mock-shared-suffix-005",
    );
  });

  it("does not promote similar suffixes to a verified cross-system link", () => {
    const crmState = response.sources.crm;
    const lmsState = response.sources.lms;
    if (crmState.status !== "success" || lmsState.status !== "success") {
      throw new Error("Expected successful fixture states");
    }

    const crmCustomerIds = new Set(
      crmState.data.map(({ crmCustomerId }) => crmCustomerId),
    );

    for (const student of lmsState.data) {
      expect(crmCustomerIds.has(student.lmsCustomerId)).toBe(false);
      expect(() => createLmsStudentSummary(student)).not.toThrow();
    }

    expect(missingOrMismatchedLinksFixture).not.toHaveProperty("links");
  });
});
