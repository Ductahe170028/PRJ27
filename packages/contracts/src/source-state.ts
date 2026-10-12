import type { ApiError } from "./api-error.js";

export type SourceStateStatus =
  | "idle"
  | "loading"
  | "success"
  | "empty"
  | "partial"
  | "forbidden"
  | "unavailable"
  | "error";

/**
 * State of one independently loaded data source.
 *
 * TData stays generic so this contract does not define CRM or LMS business
 * models. The status discriminant makes data/error requirements explicit.
 */
export type SourceState<TData> =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly data: TData }
  | { readonly status: "empty" }
  | {
      readonly status: "partial";
      readonly data: TData;
      readonly error: ApiError;
    }
  | { readonly status: "forbidden"; readonly error: ApiError }
  | { readonly status: "unavailable"; readonly error: ApiError }
  | { readonly status: "error"; readonly error: ApiError };

export type SettledSourceState<TData> = Exclude<
  SourceState<TData>,
  { readonly status: "idle" | "loading" }
>;
