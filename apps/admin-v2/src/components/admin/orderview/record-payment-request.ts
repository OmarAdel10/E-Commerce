import { toMinor } from "@scalius/shared/money";
import type { RecordedPaymentVia } from "@scalius/shared/payment-terms";

export function prepareRecordedPayment(input: {
  orderId: string;
  orderVersion: number;
  requestKey: string;
  amount: number | null;
  decimalPlaces: number;
  balanceDue: number;
  isDeposit: boolean;
  depositAmount?: number;
  via: RecordedPaymentVia;
  reference: string;
  note: string;
}) {
  const { amount, balanceDue, isDeposit, depositAmount } = input;
  if (amount === null || !Number.isFinite(amount) || amount <= 0) {
    return { issue: "netTerms.amountRequired" } as const;
  }
  if (isDeposit) {
    if (depositAmount == null) return { issue: "netTerms.amountRequired" } as const;
    if (amount !== depositAmount) return { issue: "codDeposit.amountMustMatch", limit: depositAmount } as const;
  } else if (amount > balanceDue) {
    return { issue: "netTerms.amountTooHigh", limit: balanceDue } as const;
  }
  const reference = input.reference.trim();
  const note = input.note.trim();
  return {
    request: {
      orderId: input.orderId,
      requestKey: input.requestKey,
      amountMinor: toMinor(amount, input.decimalPlaces),
      via: input.via,
      ...(isDeposit ? { paymentType: "deposit" as const } : {}),
      ...(reference ? { reference } : {}),
      ...(note ? { note } : {}),
      expectedRevision: input.orderVersion,
    },
  };
}
