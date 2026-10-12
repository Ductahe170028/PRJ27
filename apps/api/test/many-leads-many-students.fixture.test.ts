import type { SearchResponse } from "@mindx-360/contracts";
import { describe, expect, it } from "vitest";

import {
  createCrmLeadSummary,
  type CrmLeadSummary,
} from "../src/modules/crm/models/crm-lead-summary.js";
import {
  createLmsStudentSummary,
  type LmsStudentSummary,
} from "../src/modules/lms/models/lms-student-summary.js";
import { manyLeadsManyStudentsFixture } from "../src/modules/mindx360/fixtures/many-leads-many-students.fixture.js";

describe("manyLeadsManyStudentsFixture", () => {
  const response: SearchResponse<CrmLeadSummary, LmsStudentSummary> =
    manyLeadsManyStudentsFixture.response;

  it("returns every Lead and Student for the same synthetic search phone", () => {
    expect(manyLeadsManyStudentsFixture.searchPhone).toBe("0000000004");
    expect(response.status).toBe("success");

    const crmState = response.sources.crm;
    const lmsState = response.sources.lms;
    if (crmState.status !== "success" || lmsState.status !== "success") {
      throw new Error("Expected successful fixture states");
    }

    expect(crmState.data).toHaveLength(2);
    expect(lmsState.data).toHaveLength(2);
    expect(crmState.data.map(({ crmLeadId }) => crmLeadId)).toEqual([
      "crm:lead:mock-041",
      "crm:lead:mock-042",
    ]);
    expect(lmsState.data.map(({ lmsStudentId }) => lmsStudentId)).toEqual([
      "lms:student:mock-041",
      "lms:student:mock-042",
    ]);
  });

  it("validates every result instead of relying on the first item", () => {
    const crmState = response.sources.crm;
    const lmsState = response.sources.lms;
    if (crmState.status !== "success" || lmsState.status !== "success") {
      throw new Error("Expected successful fixture states");
    }

    for (const lead of crmState.data) {
      expect(() => createCrmLeadSummary(lead)).not.toThrow();
    }
    for (const student of lmsState.data) {
      expect(() => createLmsStudentSummary(student)).not.toThrow();
    }

    expect(new Set(crmState.data.map(({ crmLeadId }) => crmLeadId)).size).toBe(
      crmState.data.length,
    );
    expect(
      new Set(lmsState.data.map(({ lmsStudentId }) => lmsStudentId)).size,
    ).toBe(lmsState.data.length);
  });

  it("does not equate CRM and LMS customer identifiers", () => {
    const crmState = response.sources.crm;
    const lmsState = response.sources.lms;
    if (crmState.status !== "success" || lmsState.status !== "success") {
      throw new Error("Expected successful fixture states");
    }

    const crmCustomerIds = new Set(
      crmState.data.map(({ crmCustomerId }) => crmCustomerId),
    );
    const lmsCustomerIds = new Set(
      lmsState.data.map(({ lmsCustomerId }) => lmsCustomerId),
    );

    expect(crmCustomerIds).toEqual(
      new Set(["crm:customer:mock-parent-004"]),
    );
    expect(lmsCustomerIds).toEqual(
      new Set(["lms:customer:mock-parent-004"]),
    );
    expect(manyLeadsManyStudentsFixture).not.toHaveProperty("links");
  });
});
