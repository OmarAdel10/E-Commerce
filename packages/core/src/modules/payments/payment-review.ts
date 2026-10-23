// A payment its provider flagged for review (the payment port's `review`:
// SSLCommerz's high-risk rating, any gateway's fraud screen). The money is
// real and counts as paid; nothing is handed over until staff look. The
// payment keeps the provider's words in its metadata (`review`), and the
// platform holds the order (`order_holds`) in the payment's own batch, so no
// shipment or automatic hand-over runs between the money landing and the hold.
// Staff release the hold; the app cannot (it is not its `ctx.orders.hold`).

import { sql, type SQL } from "drizzle-orm";
import type { Database } from "@scalius/database/client";
import { orderHolds, orders, pluginInstallations } from "@scalius/database/schema";
import { sha256Hex } from "@scalius/shared/hash";
import { parseQualifiedProviderId } from "@scalius/shared/plugins/providers/kinds";
import type { PaymentReview } from "@scalius/shared/plugins/providers/payment";

/** The payment metadata key the provider's review rides under. */
export const PAYMENT_REVIEW_METADATA_KEY = "review";

/** Why the platform holds the order: the provider's words, then what staff do. */
export function paymentReviewHoldReason(review: PaymentReview): string {
  return [
    `The payment provider flagged this payment for review: ${review.reason}`,
    "The money was received. Check the order with the buyer before you ship or hand anything over, then release the hold.",
  ].join("\n").slice(0, 1_200);
}

/** The provider's review stored with a payment, or null for an ordinary payment. */
export function paymentReviewFromMetadata(metadata: string | null | undefined): PaymentReview | null {
  if (!metadata) return null;
  try {
    const review = (JSON.parse(metadata) as Record<string, unknown> | null)?.[PAYMENT_REVIEW_METADATA_KEY];
    if (review && typeof review === "object" && typeof (review as { reason?: unknown }).reason === "string") {
      const reason = (review as { reason: string }).reason.trim().slice(0, 300);
      return reason ? { reason } : null;
    }
  } catch {
    // Unreadable metadata carries no review.
  }
  return null;
}

/**
 * The review hold for one flagged payment, written only when `landed` holds
 * (the payment row and the order's new version committed in this batch). One
 * per payment: a retried event adds nothing, and a released hold is not
 * placed again. Named after the app whose provider flagged it (its installed
 * name, else its id). Wrapped: a query builder is a thenable.
 */
export async function buildPaymentReviewHoldInsert(
  db: Database,
  input: { orderId: string; paymentId: string; provider: string; review: PaymentReview; landed: SQL },
) {
  const id = `ohd_${(await sha256Hex(`order-hold\0provider-review\0${input.orderId}\0${input.paymentId}`)).slice(0, 32)}`;
  const pluginId = parseQualifiedProviderId(input.provider)?.pluginId ?? input.provider;
  const appName = sql<string>`COALESCE(
    (SELECT NULLIF(substr(trim(json_extract(${pluginInstallations.manifestJson}, '$.name')), 1, 80), '')
      FROM ${pluginInstallations} WHERE ${pluginInstallations.pluginId} = ${pluginId}),
    ${pluginId.slice(0, 80)}
  )`;
  return { statement: db.insert(orderHolds).select(db.select({
    id: sql<string>`${id}`.as("id"),
    orderId: orders.id,
    pluginId: sql<string>`${pluginId}`.as("plugin_id"),
    appName: appName.as("app_name"),
    reason: sql<string>`${paymentReviewHoldReason(input.review)}`.as("reason"),
    createdAt: sql<number>`unixepoch()`.as("created_at"),
    releasedAt: sql<null>`NULL`.as("released_at"),
    releasedBy: sql<null>`NULL`.as("released_by"),
  }).from(orders).where(sql`${orders.id} = ${input.orderId} AND ${input.landed}`)).onConflictDoNothing({ target: orderHolds.id }) };
}
