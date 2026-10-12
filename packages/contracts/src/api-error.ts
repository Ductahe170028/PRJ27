export type DataSource = "crm" | "lms";

export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "UPSTREAM_ERROR"
  | "UNKNOWN";

/**
 * Safe error information that may cross the backend/frontend boundary.
 * Upstream response bodies and credentials must not be included.
 */
export interface ApiError {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly source?: DataSource;
}
