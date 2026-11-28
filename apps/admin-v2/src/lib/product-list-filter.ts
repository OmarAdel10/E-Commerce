/** The list filter fields the "all matching" bulk actions forward. */
export type ProductListStatus = "active" | "draft";
export type ProductListChannelState = "published" | "unpublished";
export type ProductListDepositPolicy = "inherit" | "required" | "exempt";

export interface ProductListFilterState {
  category?: string | null;
  status?: ProductListStatus | null;
  trashed?: boolean | null;
  channel?: string | null;
  channelState?: ProductListChannelState | null;
  codDepositPolicy?: ProductListDepositPolicy | null;
}

/** The filter the "all matching" bulk actions send to the API. */
export interface ProductMatchingFilter {
  search?: string;
  category?: string;
  status?: ProductListStatus;
  salesChannel?: string;
  salesChannelState?: ProductListChannelState;
  codDepositPolicy?: ProductListDepositPolicy;
  appFilter?: string;
  /** The bulk action components carry the filter as a plain record. */
  [key: string]: unknown;
}

/**
 * The list's filter as "all matching" bulk actions send it (the API reads the
 * rows).
 *
 * Every filter the list shows travels with the request: a bulk action that
 * runs "all matching" reads the rows on the server, so a filter the request
 * drops would make the action reach rows the merchant filtered out.
 */
export function productMatchingFilter(
  search: ProductListFilterState,
  term: string,
  appFilter: string | undefined,
): ProductMatchingFilter {
  return {
    ...(term ? { search: term } : {}),
    ...(search.category ? { category: search.category } : {}),
    ...(search.status && !search.trashed ? { status: search.status } : {}),
    ...(search.channel ? { salesChannel: search.channel, salesChannelState: search.channelState ?? "published" } : {}),
    ...(search.codDepositPolicy ? { codDepositPolicy: search.codDepositPolicy } : {}),
    ...(appFilter ? { appFilter } : {}),
  };
}
