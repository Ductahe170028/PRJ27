import { describe, expect, it } from "vitest";

import { createCrmLeadSummary } from "../src/modules/crm/models/crm-lead-summary.js";

describe("createCrmLeadSummary", () => {
  it("creates a summary from documented search fields", () => {
    expect(
      createCrmLeadSummary({
        crmLeadId: "crm-lead-1",
        crmCustomerId: "crm-customer-1",
        customerName: "Customer One",
        status: "raw-lead-status",
        businessUnitId: "crm-business-unit-1",
        ownerName: "Owner One",
      }),
    ).toEqual({
      crmLeadId: "crm-lead-1",
      crmCustomerId: "crm-customer-1",
      customerName: "Customer One",
      status: "raw-lead-status",
      businessUnitId: "crm-business-unit-1",
      ownerName: "Owner One",
    });
  });

  it("keeps missing optional source data explicit as null", () => {
    expect(createCrmLeadSummary({ crmLeadId: "crm-lead-1" })).toEqual({
      crmLeadId: "crm-lead-1",
      crmCustomerId: null,
      customerName: null,
      status: null,
      businessUnitId: null,
      ownerName: null,
    });
  });

  it.each([
    [{}, "crmLeadId"],
    [{ crmLeadId: "   " }, "crmLeadId"],
    [{ crmLeadId: "crm-lead-1", status: 42 }, "status"],
  ])("rejects invalid data %#", (input, fieldName) => {
    expect(() => createCrmLeadSummary(input)).toThrow(
      `${fieldName} must be a non-empty string`,
    );
  });

  it("does not constrain a search to one Lead", () => {
    const leads = ["crm-lead-1", "crm-lead-2"].map((crmLeadId) =>
      createCrmLeadSummary({ crmLeadId }),
    );

    expect(leads.map(({ crmLeadId }) => crmLeadId)).toEqual([
      "crm-lead-1",
      "crm-lead-2",
    ]);
  });
});
