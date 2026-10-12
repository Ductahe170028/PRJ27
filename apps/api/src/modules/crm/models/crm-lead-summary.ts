import {
  optionalNonBlankString,
  requireNonBlankString,
} from "../../../shared/model-validation.js";

/**
 * Minimal CRM Lead information needed by the phone-search result.
 *
 * Lead_getList confirms these source fields. No separate CRM Lead display code
 * is documented, so crmLeadId is the only Lead identifier in this model.
 * Raw status values are preserved without business-label mapping.
 */
export interface CrmLeadSummary {
  readonly crmLeadId: string;
  readonly crmCustomerId: string | null;
  readonly customerName: string | null;
  readonly status: string | null;
  readonly businessUnitId: string | null;
  readonly ownerName: string | null;
}

export interface CrmLeadSummaryInput {
  readonly crmLeadId?: unknown;
  readonly crmCustomerId?: unknown;
  readonly customerName?: unknown;
  readonly status?: unknown;
  readonly businessUnitId?: unknown;
  readonly ownerName?: unknown;
}

export function createCrmLeadSummary(
  input: CrmLeadSummaryInput,
): CrmLeadSummary {
  return {
    crmLeadId: requireNonBlankString(input.crmLeadId, "crmLeadId"),
    crmCustomerId: optionalNonBlankString(
      input.crmCustomerId,
      "crmCustomerId",
    ),
    customerName: optionalNonBlankString(input.customerName, "customerName"),
    status: optionalNonBlankString(input.status, "status"),
    businessUnitId: optionalNonBlankString(
      input.businessUnitId,
      "businessUnitId",
    ),
    ownerName: optionalNonBlankString(input.ownerName, "ownerName"),
  };
}
