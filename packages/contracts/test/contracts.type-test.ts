import type {
  ApiError,
  SearchResponse,
  SearchResponseStatus,
  SearchSourceState,
  SourceState,
  SourceStateStatus,
} from "../src/index.js";

type CrmSearchItem = { readonly id: string };
type LmsSearchItem = { readonly studentId: string };
type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() =>
    T extends TRight ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

const unavailableError = {
  code: "UNAVAILABLE",
  message: "LMS is temporarily unavailable",
  retryable: true,
  source: "lms",
} satisfies ApiError;

const sourceStatuses = [
  "idle",
  "loading",
  "success",
  "empty",
  "partial",
  "forbidden",
  "unavailable",
  "error",
] as const satisfies readonly SourceStateStatus[];

const sourceStates = [
  { status: "idle" },
  { status: "loading" },
  { status: "success", data: [{ id: "crm-1" }] },
  { status: "empty" },
  {
    status: "partial",
    data: [{ id: "crm-1" }],
    error: {
      code: "UPSTREAM_ERROR",
      message: "A later CRM page could not be loaded",
      retryable: true,
      source: "crm",
    },
  },
  {
    status: "forbidden",
    error: {
      code: "FORBIDDEN",
      message: "CRM access is forbidden",
      retryable: false,
      source: "crm",
    },
  },
  { status: "unavailable", error: unavailableError },
  {
    status: "error",
    error: {
      code: "UNKNOWN",
      message: "CRM returned an unknown error",
      retryable: false,
      source: "crm",
    },
  },
] satisfies readonly SourceState<readonly CrmSearchItem[]>[];

const responseStatuses = [
  "success",
  "empty",
  "partial",
  "error",
] as const satisfies readonly SearchResponseStatus[];

type SourceStatusesAreExhaustive = Expect<
  Equal<SourceStateStatus, (typeof sourceStatuses)[number]>
>;
type ResponseStatusesAreExhaustive = Expect<
  Equal<SearchResponseStatus, (typeof responseStatuses)[number]>
>;

const searchResponses = [
  {
    status: "success",
    sources: {
      crm: { status: "success", data: [{ id: "crm-1" }] },
      lms: { status: "success", data: [{ studentId: "student-1" }] },
    },
  },
  {
    status: "empty",
    sources: {
      crm: { status: "empty" },
      lms: { status: "empty" },
    },
  },
  {
    status: "partial",
    sources: {
      crm: { status: "success", data: [{ id: "crm-1" }] },
      lms: { status: "unavailable", error: unavailableError },
    },
  },
  {
    status: "error",
    sources: {
      crm: {
        status: "error",
        error: {
          code: "UPSTREAM_ERROR",
          message: "CRM request failed",
          retryable: true,
          source: "crm",
        },
      },
      lms: { status: "unavailable", error: unavailableError },
    },
  },
] satisfies readonly SearchResponse<CrmSearchItem, LmsSearchItem>[];

const settledSearchSource = {
  status: "success",
  data: [{ studentId: "student-1" }],
} satisfies SearchSourceState<LmsSearchItem>;

// @ts-expect-error A successful source must provide data.
const successWithoutData: SourceState<readonly CrmSearchItem[]> = {
  status: "success",
};

const pendingSearchSource: SearchSourceState<LmsSearchItem> = {
  // @ts-expect-error An API search response cannot contain a pending source.
  status: "loading",
};

void sourceStatuses;
void sourceStates;
void responseStatuses;
void searchResponses;
void settledSearchSource;
void successWithoutData;
void pendingSearchSource;
void (true as SourceStatusesAreExhaustive);
void (true as ResponseStatusesAreExhaustive);
