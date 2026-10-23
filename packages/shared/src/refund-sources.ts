// How an original-method refund is split across an order's captured
// payments. One rule: `processRefund()` allocates by it, and the dashboard's
// refund dialog previews the same split from the ordered sources the order's
// payments read returns. Browser-safe.
//
// The sources come in refund order (core builds it: newest capture first,
// gift-card tenders last), each with what is still refundable after earlier
// refunds. A refund fills them in that order.

/**
 * How one source's money goes back: `provider` through its gateway,
 * `manual` by hand (cash on delivery, a recorded bank transfer or cheque:
 * staff pay it back and confirm it), `gift_card` onto the tender's card.
 */
export type RefundSourceSettlement = "provider" | "manual" | "gift_card";

export interface RefundSourceShare<T> {
  source: T;
  amountMinor: number;
}

/** Fill `amountMinor` across `sources` in order; what no source can take is `unallocatedMinor`. */
export function allocateRefundAcrossSources<T extends { refundableMinor: number }>(
  sources: readonly T[],
  amountMinor: number,
): { shares: RefundSourceShare<T>[]; unallocatedMinor: number } {
  let remaining = Math.max(0, amountMinor);
  const shares: RefundSourceShare<T>[] = [];
  for (const source of sources) {
    if (remaining <= 0) break;
    const take = Math.min(Math.max(0, source.refundableMinor), remaining);
    if (take <= 0) continue;
    shares.push({ source, amountMinor: take });
    remaining -= take;
  }
  return { shares, unallocatedMinor: remaining };
}

/** How much of a refund each settlement carries (minor units). */
export function refundSettlementTotals(
  sources: readonly { refundableMinor: number; settlement: RefundSourceSettlement }[],
  amountMinor: number,
): Record<RefundSourceSettlement, number> {
  const totals: Record<RefundSourceSettlement, number> = { provider: 0, manual: 0, gift_card: 0 };
  for (const share of allocateRefundAcrossSources(sources, amountMinor).shares) {
    totals[share.source.settlement] += share.amountMinor;
  }
  return totals;
}
