import type { PricePair } from "~/components/admin/product-form/compare-at";
import { readAdminApiError } from "~/lib/admin-api-error";

/** One editable cell set of a product row in the bulk editor. */
export interface BulkEditDraft {
  isActive: boolean;
  pair: PricePair;
  /** Null: the default profile (General). */
  profileId: string | null;
  /** Manual COD deposit policy: inherit / required / exempt. */
  codDepositPolicy: "inherit" | "required" | "exempt";
  /** SKU id -> on hand. */
  stock: Record<string, number | null>;
  /** Shipped SKU id -> grams (null: no weight). */
  weight: Record<string, number | null>;
}

/**
 * The values a row held when the merchant started editing it, plus the
 * product revision those values came from.
 *
 * The draft is compared with this baseline, never with a refetched row: a
 * write by another admin between the edit and the save moves the refetched
 * row, and comparing against it would turn every untouched cell into a
 * change and overwrite the other admin with stale values.
 */
export interface BulkEditBaseline {
  draft: BulkEditDraft;
  revision: number;
}

/** Copies a row into a baseline, so later edits cannot rewrite it. */
export const captureBulkEditBaseline = (draft: BulkEditDraft, revision: number): BulkEditBaseline => ({
  draft: { ...draft, pair: { ...draft.pair }, stock: { ...draft.stock }, weight: { ...draft.weight } },
  revision,
});

/** The base-section fields one patch can carry. */
export type BasePatch = {
  isActive?: boolean;
  price?: number;
  discountType?: string;
  discountAmount?: number;
  discountPercentage?: number;
  shippingProfileId?: string | null;
  codDepositPolicy?: "inherit" | "required" | "exempt";
};

/**
 * True when a fresh product row already holds every value the patch intended
 * to write.
 *
 * A write whose response never arrived may still have committed on the
 * server. Comparing the fresh row with the patch tells the editor that the
 * write landed, so the row continues with the remaining edits instead of
 * retrying a change the server already applied against a revision it moved
 * past.
 */
export const productMatchesBasePatch = (row: BasePatch, patch: BasePatch): boolean =>
  Object.entries(patch).every(([field, value]) => row[field as keyof BasePatch] === value);

/**
 * True when a failed write leaves the editor in doubt: no answer arrived, or
 * the server faulted.
 *
 * A write whose response never arrived may still have committed on the
 * server, and a server fault (5xx) can arrive after the write committed, so
 * both leave the editor to check the fresh row before it continues.
 *
 * A refusal the server did send is authoritative: a stale revision (409) or
 * a rejected value (422) means the write did not take the row where the
 * editor wanted it. Reconciling such a failure against a fresh row would
 * adopt another admin's write - or the editor's own - instead of reporting
 * the refusal, and the next write would then overwrite a value nobody
 * changed.
 */
export const isLostWriteResponse = (error: unknown): boolean => {
  const status = readAdminApiError(error)?.status;
  if (status == null) return true;
  return status >= 500;
};

/**
 * True when a fresh product row already holds the weight a write intended.
 *
 * A weight write whose response never arrived may still have committed. The
 * fresh row tells the editor that it landed, so the row continues with the
 * revision the server moved to instead of repeating the write against a
 * revision the server already moved past.
 */
export const productHasSkuWeight = (
  row: { skus?: readonly { id: string; weightGrams?: number | null }[] },
  skuId: string,
  grams: number | null,
): boolean => {
  const sku = row.skus?.find((entry) => entry.id === skuId);
  if (!sku) return false;
  return (sku.weightGrams ?? null) === grams;
};

/**
 * True when the server holds a different weight for a SKU than the baseline
 * the editor started from.
 *
 * A weight write must never overwrite a weight another admin changed since
 * the baseline: the editor reports the row as failed instead, so the
 * merchant decides what to do with the newer value.
 */
export const productSkuWeightChanged = (
  row: { skus?: readonly { id: string; weightGrams?: number | null }[] },
  skuId: string,
  baselineGrams: number | null,
): boolean => {
  const sku = row.skus?.find((entry) => entry.id === skuId);
  if (!sku) return false;
  return (sku.weightGrams ?? null) !== baselineGrams;
};

/**
 * The outcome of reading a product row back from the server.
 *
 * A failed read is not an absent row: the editor must tell the two apart, or a
 * transport failure looks like a deleted product and hides the real problem.
 */
export interface BulkRowRead<T> {
  /** The row the server returned, or null when it has no such row. */
  row: T | null;
  /** The failure the read ran into, or null when the read succeeded. */
  error: unknown | null;
}

/**
 * Reads a product row back, keeping a transport failure apart from an absent
 * row.
 *
 * @param read The read to run.
 */
export const readBulkRow = async <T>(read: () => Promise<T | null>): Promise<BulkRowRead<T>> => {
  try {
    return { row: await read(), error: null };
  } catch (error) {
    return { row: null, error };
  }
};

/**
 * True when two rows hold the same price and compare-at price.
 */
export const samePricePair = (a: PricePair, b: PricePair): boolean => a.price === b.price && a.compareAt === b.compareAt;

/**
 * The row values after the server accepted a base patch.
 *
 * Only the fields the patch carried changed; every other field keeps the
 * value the baseline held. The result replaces the baseline, so a retry
 * sends only what the server still misses.
 *
 * @param was The baseline the patch was built from.
 * @param next The draft the merchant typed.
 * @param patch The base patch the server accepted.
 */
export const acknowledgeBasePatch = (was: BulkEditDraft, next: BulkEditDraft, patch: Record<string, unknown>): BulkEditDraft => ({
  ...was,
  isActive: "isActive" in patch ? next.isActive : was.isActive,
  pair: "price" in patch ? next.pair : was.pair,
  profileId: "shippingProfileId" in patch ? next.profileId : was.profileId,
  codDepositPolicy: "codDepositPolicy" in patch ? next.codDepositPolicy : was.codDepositPolicy,
});

/**
 * True when the draft differs from the captured baseline in any cell.
 *
 * @param next The draft the merchant typed.
 * @param was The captured baseline the draft started from.
 * @param skuIds The shipped SKU ids to compare stock and weight for.
 */
export const hasBulkEditChanges = (next: BulkEditDraft, was: BulkEditDraft, skuIds: string[]): boolean =>
  next.isActive !== was.isActive
  || !samePricePair(next.pair, was.pair)
  || next.profileId !== was.profileId
  || next.codDepositPolicy !== was.codDepositPolicy
  || skuIds.some((skuId) => next.stock[skuId] !== was.stock[skuId] || next.weight[skuId] !== was.weight[skuId]);
