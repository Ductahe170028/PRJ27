import type { SearchSourceState } from "@mindx-360/contracts";
import { describe, expect, it, vi } from "vitest";

import type { CrmSearchClient } from "../src/modules/crm/clients/crm-search-client.js";
import {
  createCrmLeadSummary,
  type CrmLeadSummary,
} from "../src/modules/crm/models/crm-lead-summary.js";
import type { LmsSearchClient } from "../src/modules/lms/clients/lms-search-client.js";
import {
  createLmsStudentSummary,
  type LmsStudentSummary,
} from "../src/modules/lms/models/lms-student-summary.js";
import { SearchByPhoneService } from "../src/modules/mindx360/services/search-by-phone.service.js";

const lead = createCrmLeadSummary({ crmLeadId: "crm:lead:mock-071" });
const secondLead = createCrmLeadSummary({ crmLeadId: "crm:lead:mock-072" });
const student = createLmsStudentSummary({
  lmsStudentId: "lms:student:mock-071",
});
const secondStudent = createLmsStudentSummary({
  lmsStudentId: "lms:student:mock-072",
});

const crmUnavailable: SearchSourceState<CrmLeadSummary> = {
  status: "unavailable",
  error: {
    code: "UNAVAILABLE",
    message: "Synthetic CRM outage",
    retryable: true,
    source: "crm",
  },
};
const lmsUnavailable: SearchSourceState<LmsStudentSummary> = {
  status: "unavailable",
  error: {
    code: "UNAVAILABLE",
    message: "Synthetic LMS outage",
    retryable: true,
    source: "lms",
  },
};

function createService(
  crmState: SearchSourceState<CrmLeadSummary>,
  lmsState: SearchSourceState<LmsStudentSummary>,
) {
  const crmSearch = vi.fn(async () => crmState);
  const lmsSearch = vi.fn(async () => lmsState);
  const crmClient: CrmSearchClient = { searchByPhone: crmSearch };
  const lmsClient: LmsSearchClient = { searchByPhone: lmsSearch };

  return {
    crmSearch,
    lmsSearch,
    service: new SearchByPhoneService(crmClient, lmsClient),
  };
}

describe("SearchByPhoneService", () => {
  it("keeps all successful CRM and LMS results", async () => {
    const { crmSearch, lmsSearch, service } = createService(
      { status: "success", data: [lead, secondLead] },
      { status: "success", data: [student, secondStudent] },
    );

    const result = await service.searchByPhone("0000000007");

    expect(result.status).toBe("success");
    expect(result.sources.crm).toMatchObject({
      status: "success",
      data: [lead, secondLead],
    });
    expect(result.sources.lms).toMatchObject({
      status: "success",
      data: [student, secondStudent],
    });
    expect(crmSearch).toHaveBeenCalledWith("0000000007");
    expect(lmsSearch).toHaveBeenCalledWith("0000000007");
  });

  it("distinguishes no data from an API error", async () => {
    const { service } = createService(
      { status: "empty" },
      { status: "empty" },
    );

    await expect(service.searchByPhone("0000000070")).resolves.toEqual({
      status: "empty",
      sources: {
        crm: { status: "empty" },
        lms: { status: "empty" },
      },
    });
  });

  it("returns partial and preserves LMS data when CRM fails", async () => {
    const { service } = createService(crmUnavailable, {
      status: "success",
      data: [student],
    });

    const result = await service.searchByPhone("0000000071");

    expect(result.status).toBe("partial");
    expect(result.sources.crm).toEqual(crmUnavailable);
    expect(result.sources.lms).toEqual({ status: "success", data: [student] });
  });

  it("returns partial and preserves CRM data when LMS fails", async () => {
    const { service } = createService(
      { status: "success", data: [lead] },
      lmsUnavailable,
    );

    const result = await service.searchByPhone("0000000072");

    expect(result.status).toBe("partial");
    expect(result.sources.crm).toEqual({ status: "success", data: [lead] });
    expect(result.sources.lms).toEqual(lmsUnavailable);
  });

  it("returns error only when both sources fail", async () => {
    const { service } = createService(crmUnavailable, lmsUnavailable);

    const result = await service.searchByPhone("0000000073");

    expect(result.status).toBe("error");
    expect(result.sources.crm).toEqual(crmUnavailable);
    expect(result.sources.lms).toEqual(lmsUnavailable);
  });

  it("treats success from one source and empty from the other as success", async () => {
    const { service } = createService(
      { status: "success", data: [lead] },
      { status: "empty" },
    );

    await expect(service.searchByPhone("0000000074")).resolves.toMatchObject({
      status: "success",
      sources: {
        crm: { status: "success", data: [lead] },
        lms: { status: "empty" },
      },
    });
  });

  it("keeps an explicitly partial source state", async () => {
    const partialCrm: SearchSourceState<CrmLeadSummary> = {
      status: "partial",
      data: [lead],
      error: {
        code: "UPSTREAM_ERROR",
        message: "A later synthetic page failed",
        retryable: true,
        source: "crm",
      },
    };
    const { service } = createService(partialCrm, { status: "empty" });

    const result = await service.searchByPhone("0000000075");

    expect(result.status).toBe("partial");
    expect(result.sources.crm).toEqual(partialCrm);
  });

  it("isolates an unexpected client rejection without leaking its message", async () => {
    const crmClient: CrmSearchClient = {
      searchByPhone: vi.fn(async () => {
        throw new Error("sensitive upstream detail");
      }),
    };
    const lmsClient: LmsSearchClient = {
      searchByPhone: vi.fn(
        async (): Promise<SearchSourceState<LmsStudentSummary>> => ({
          status: "success",
          data: [student],
        }),
      ),
    };
    const service = new SearchByPhoneService(crmClient, lmsClient);

    const result = await service.searchByPhone("0000000076");

    expect(result.status).toBe("partial");
    expect(result.sources.crm).toEqual({
      status: "error",
      error: {
        code: "UNKNOWN",
        message: "CRM search failed unexpectedly",
        retryable: false,
        source: "crm",
      },
    });
    expect(JSON.stringify(result)).not.toContain("sensitive upstream detail");
    expect(result.sources.lms).toEqual({
      status: "success",
      data: [student],
    });
  });
});
