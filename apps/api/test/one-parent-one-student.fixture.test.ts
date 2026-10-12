import type { SearchResponse } from "@mindx-360/contracts";
import { describe, expect, it } from "vitest";

import { createCrmLeadSummary } from "../src/modules/crm/models/crm-lead-summary.js";
import { createLmsStudentSummary } from "../src/modules/lms/models/lms-student-summary.js";
import { oneParentOneStudentFixture } from "../src/modules/mindx360/fixtures/one-parent-one-student.fixture.js";

describe("oneParentOneStudentFixture", () => {
  const response: SearchResponse<
    ReturnType<typeof createCrmLeadSummary>,
    ReturnType<typeof createLmsStudentSummary>
  > = oneParentOneStudentFixture.response;

  it("represents one synthetic phone search across both sources", () => {
    expect(oneParentOneStudentFixture.searchPhone).toBe("0000000000");
    expect(response.status).toBe("success");
    expect(response.sources.crm.status).toBe("success");
    expect(response.sources.lms.status).toBe("success");
  });

  it("contains exactly one valid CRM Lead summary", () => {
    const crmState = response.sources.crm;

    expect(crmState.status).toBe("success");
    if (crmState.status !== "success") {
      throw new Error("Expected a successful CRM fixture state");
    }

    expect(crmState.data).toHaveLength(1);
    const lead = crmState.data[0];
    if (lead === undefined) {
      throw new Error("Expected one CRM Lead summary");
    }

    expect(() => createCrmLeadSummary(lead)).not.toThrow();
    expect(lead.crmLeadId).toBe("crm:lead:mock-001");
  });

  it("contains exactly one valid LMS Student summary", () => {
    const lmsState = response.sources.lms;

    expect(lmsState.status).toBe("success");
    if (lmsState.status !== "success") {
      throw new Error("Expected a successful LMS fixture state");
    }

    expect(lmsState.data).toHaveLength(1);
    const student = lmsState.data[0];
    if (student === undefined) {
      throw new Error("Expected one LMS Student summary");
    }

    expect(() => createLmsStudentSummary(student)).not.toThrow();
    expect(student.lmsStudentId).toBe("lms:student:mock-001");
    expect(student.studentCode).toBe("STUDENT-MOCK-001");
  });

  it("does not infer a CRM to LMS link from the shared search phone", () => {
    const crmState = response.sources.crm;
    const lmsState = response.sources.lms;

    if (crmState.status !== "success" || lmsState.status !== "success") {
      throw new Error("Expected successful source states");
    }

    const lead = crmState.data[0];
    const student = lmsState.data[0];
    if (lead === undefined || student === undefined) {
      throw new Error("Expected one result from each source");
    }

    expect(lead.crmCustomerId).not.toBe(student.lmsCustomerId);
    expect(oneParentOneStudentFixture).not.toHaveProperty("links");
  });

  it("contains only obviously synthetic identity values", () => {
    const serializedFixture = JSON.stringify(oneParentOneStudentFixture);

    expect(serializedFixture).toContain("mock");
    expect(serializedFixture).toContain("giả lập");
    expect(serializedFixture).not.toContain("@mindx.edu.vn");
  });
});
