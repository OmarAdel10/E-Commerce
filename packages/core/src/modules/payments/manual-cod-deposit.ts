// Shared guard for manual COD deposit orders: a manual-kind payment plan whose
// status is `pending` (deposit never verified by staff) or `cancelled` (deposit
// refunded) blocks fulfilment progression until the deposit is recorded. Only a
// `deposit_paid` plan unblocks fulfilment; a `completed` plan remains valid.
//
// Imported and called at every server-side order-status write (P1–P6) so an
// unverified-deposit COD order can never be confirmed, shipped, handed over,
// or advanced through any alternate fulfilment path.
//
// The guard itself lives in the order kernel, the leaf the delivery, payment
// and fulfilment domains all share. It is re-exported here so a caller that
// works with payments keeps one import path.

export {
    assertManualCodDepositVerified,
    ManualCodDepositBlockedError,
    readPaymentPlan,
} from "../order-kernel";
