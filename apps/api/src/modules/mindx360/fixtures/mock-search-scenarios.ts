import type { ApiError, SearchSourceState } from "@mindx-360/contracts";

import type { MockCrmSearchScenarios } from "../../crm/clients/mock-crm-search-client.js";
import {
  createCrmLeadSummary,
  type CrmLeadSummary,
} from "../../crm/models/crm-lead-summary.js";
import type { MockLmsSearchScenarios } from "../../lms/clients/mock-lms-search-client.js";
import {
  createLmsStudentSummary,
  type LmsStudentSummary,
} from "../../lms/models/lms-student-summary.js";
import { manyLeadsManyStudentsFixture } from "./many-leads-many-students.fixture.js";
import { missingOrMismatchedLinksFixture } from "./missing-or-mismatched-links.fixture.js";
import { oneParentOneStudentFixture } from "./one-parent-one-student.fixture.js";

export const mockSearchPhones = {
  oneParentOneStudent: oneParentOneStudentFixture.searchPhone,
  manyLeadsManyStudents: manyLeadsManyStudentsFixture.searchPhone,
  missingOrMismatchedLinks: missingOrMismatchedLinksFixture.searchPhone,
  empty: "0000000080",
  crmError: "0000000081",
  lmsError: "0000000082",
  bothError: "0000000083",
} as const;

const crmUnavailableError: ApiError = {
  code: "UNAVAILABLE",
  message: "Synthetic CRM service unavailable",
  retryable: true,
  source: "crm",
};
const lmsUnavailableError: ApiError = {
  code: "UNAVAILABLE",
  message: "Synthetic LMS service unavailable",
  retryable: true,
  source: "lms",
};

const partialCrmLead = createCrmLeadSummary({
  crmLeadId: "crm:lead:mock-partial-001",
  crmCustomerId: "crm:customer:mock-partial-001",
  customerName: "Phụ huynh giả lập partial CRM",
  status: "mock-crm-lead-status",
});
const partialLmsStudent = createLmsStudentSummary({
  lmsStudentId: "lms:student:mock-partial-001",
  studentCode: "STUDENT-MOCK-PARTIAL-001",
  fullName: "Học viên giả lập partial LMS",
  status: "mock-lms-student-status",
});

export function createMockCrmSearchScenarios(): MockCrmSearchScenarios {
  const scenarios: readonly (readonly [
    string,
    SearchSourceState<CrmLeadSummary>,
  ])[] = [
    [
      mockSearchPhones.oneParentOneStudent,
      oneParentOneStudentFixture.response.sources.crm,
    ],
    [
      mockSearchPhones.manyLeadsManyStudents,
      manyLeadsManyStudentsFixture.response.sources.crm,
    ],
    [
      mockSearchPhones.missingOrMismatchedLinks,
      missingOrMismatchedLinksFixture.response.sources.crm,
    ],
    [mockSearchPhones.empty, { status: "empty" }],
    [
      mockSearchPhones.crmError,
      { status: "unavailable", error: crmUnavailableError },
    ],
    [
      mockSearchPhones.lmsError,
      { status: "success", data: [partialCrmLead] },
    ],
    [
      mockSearchPhones.bothError,
      { status: "unavailable", error: crmUnavailableError },
    ],
  ];

  return new Map(scenarios);
}

export function createMockLmsSearchScenarios(): MockLmsSearchScenarios {
  const scenarios: readonly (readonly [
    string,
    SearchSourceState<LmsStudentSummary>,
  ])[] = [
    [
      mockSearchPhones.oneParentOneStudent,
      oneParentOneStudentFixture.response.sources.lms,
    ],
    [
      mockSearchPhones.manyLeadsManyStudents,
      manyLeadsManyStudentsFixture.response.sources.lms,
    ],
    [
      mockSearchPhones.missingOrMismatchedLinks,
      missingOrMismatchedLinksFixture.response.sources.lms,
    ],
    [mockSearchPhones.empty, { status: "empty" }],
    [
      mockSearchPhones.crmError,
      { status: "success", data: [partialLmsStudent] },
    ],
    [
      mockSearchPhones.lmsError,
      { status: "unavailable", error: lmsUnavailableError },
    ],
    [
      mockSearchPhones.bothError,
      { status: "unavailable", error: lmsUnavailableError },
    ],
  ];

  return new Map(scenarios);
}
