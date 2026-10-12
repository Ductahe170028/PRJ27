import type { SettledSourceState } from "./source-state.js";

export type SearchResponseStatus = "success" | "empty" | "partial" | "error";

export type SearchSourceState<TItem> = SettledSourceState<readonly TItem[]>;

/**
 * Settled result of a phone search. CRM and LMS remain separate so one source
 * can fail without hiding data returned by the other source.
 */
export interface SearchResponse<TCrmItem, TLmsItem> {
  readonly status: SearchResponseStatus;
  readonly sources: {
    readonly crm: SearchSourceState<TCrmItem>;
    readonly lms: SearchSourceState<TLmsItem>;
  };
}
