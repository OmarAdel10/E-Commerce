import type { PricePair } from "~/components/admin/product-form/compare-at";

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
  draft: { ...draft, stock: { ...draft.stock }, weight: { ...draft.weight } },
  revision,
});

/** True when two rows hold the same price and compare-at price. */
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
