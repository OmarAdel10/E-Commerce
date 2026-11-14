// src/modules/order-kernel/manual-deposit-guard.ts
// The manual COD deposit guard: a manual-kind payment plan whose status is
// `pending` (deposit never verified by staff) or `cancelled` (deposit
// refunded) blocks fulfilment progression until the deposit is recorded. Only
// a `deposit_paid` plan unblocks fulfilment; a `completed` plan remains valid.
//
// It lives in the order kernel because several domains act on orders below
// `orders`: the fulfilment domain, the delivery domain and the payment
// domain all need the same fact, and a leaf is where a fact several domains
// act on and none of them owns belongs.

import { eq } from "drizzle-orm";
import { paymentPlans, PaymentPlanStatus } from "@scalius/database/schema";
import type { Database } from "@scalius/database/client";
import { ValidationError } from "@scalius/core/errors";

export class ManualCodDepositBlockedError extends ValidationError {}

/** Read the payment plan for an order, if any. */
export async function readPaymentPlan(
    db: Database,
    orderId: string,
): Promise<{ id: string; status: string; kind: string } | null> {
    const plan = await db
        .select({
            id: paymentPlans.id,
            status: paymentPlans.status,
            kind: paymentPlans.kind,
        })
        .from(paymentPlans)
        .where(eq(paymentPlans.orderId, orderId))
        .get();
    if (!plan) return null;
    return plan;
}

/**
 * Assert that a manual COD deposit order's deposit has been verified by staff.
 * Throws when the plan is `pending` (never recorded) or `cancelled` (refunded).
 * Orders without a manual-kind plan are unaffected.
 */
export async function assertManualCodDepositVerified(
    db: Database,
    orderId: string,
): Promise<void> {
    const plan = await readPaymentPlan(db, orderId);
    if (!plan) return;
    if (plan.kind !== "manual") return;
    if (plan.status === PaymentPlanStatus.PENDING) {
        throw new ManualCodDepositBlockedError("The deposit must be recorded before this order can move on.");
    }
    if (plan.status === PaymentPlanStatus.CANCELLED) {
        throw new ManualCodDepositBlockedError("This order's deposit was refunded. Fulfilment is blocked.");
    }
    // deposit_paid or completed — deposit verified, fulfilment may proceed.
}
