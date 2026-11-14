export interface OrderPaymentPresentation {
  /** Cancelled, returned or refunded orders collect no more money. */
  collectionClosed: boolean;
  amountDue: number;
  manualCodDeposit: { status: "pending"; amount: number; canRecord: boolean } | { status: "received" } | null;
}

const CLOSED_COLLECTION_ORDER_STATUSES = new Set([
  "cancelled",
  "returned",
  "refunded",
]);

export function buildOrderPaymentPresentation(input: {
  orderStatus: string;
  balanceDue: number | null | undefined;
  paymentMethod?: string | null;
  paymentPlan?: { kind: string; status: string; depositAmount: number } | null;
  archived?: boolean;
  canRecordPayment?: boolean;
  refundLocked?: boolean;
}): OrderPaymentPresentation {
  const collectionClosed = CLOSED_COLLECTION_ORDER_STATUSES.has(
    input.orderStatus.trim().toLowerCase(),
  );
  const storedBalance = Number(input.balanceDue ?? 0);
  const plan = input.paymentPlan;
  let manualCodDeposit: OrderPaymentPresentation["manualCodDeposit"] = null;
  if (!collectionClosed && !input.archived && input.paymentMethod === "cod" && plan?.kind === "manual") {
    if (plan.status === "pending") {
      manualCodDeposit = {
        status: "pending",
        amount: plan.depositAmount,
        canRecord: input.canRecordPayment === true && !input.refundLocked,
      };
    } else if (plan.status === "deposit_paid") {
      manualCodDeposit = { status: "received" };
    }
  }
  return {
    collectionClosed,
    amountDue: collectionClosed || !Number.isFinite(storedBalance)
      ? 0
      : Math.max(0, storedBalance),
    manualCodDeposit,
  };
}
