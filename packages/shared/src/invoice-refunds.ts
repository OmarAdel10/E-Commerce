import { toMinor } from "./money";

interface InvoiceRefundDocument {
  order: {
    currencyDecimalPlaces?: number | null;
    totalAmount: number;
    totalAmountMinor?: number | null;
    refundedAmount?: number;
  };
  refundedSinceIssue?: number;
}

/** Original sale and separate refund annotations, in the issued currency's minor units. */
export function invoiceRefundSummary({ order, refundedSinceIssue = 0 }: InvoiceRefundDocument) {
  const decimalPlaces = order.currencyDecimalPlaces ?? 2;
  const totalMinor = order.totalAmountMinor ?? toMinor(order.totalAmount, decimalPlaces);
  const refundedMinor = toMinor(order.refundedAmount ?? 0, decimalPlaces);
  const refundedSinceIssueMinor = toMinor(refundedSinceIssue, decimalPlaces);
  const totalRefundedMinor = refundedMinor + refundedSinceIssueMinor;
  return {
    decimalPlaces,
    totalMinor,
    refundedMinor,
    refundedSinceIssueMinor,
    totalRefundedMinor,
    netTotalMinor: Math.max(0, totalMinor - totalRefundedMinor),
  };
}
