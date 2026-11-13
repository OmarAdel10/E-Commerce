import type { Database } from "@scalius/database/client";
import { ManualCodDepositBlockedError } from "../payments";
import { recordOrderEvent } from "./timeline";

/**
 * Why a courier update could not be applied to the order.
 */
export const DEPOSIT_RECONCILIATION_REASONS = ["manual_cod_deposit_not_verified"] as const;
export type DepositReconciliationReason = (typeof DEPOSIT_RECONCILIATION_REASONS)[number];

/**
 * Records that a courier update was refused because the order's manual COD
 * deposit is not verified (still pending, or refunded after the parcel left).
 *
 * The courier's own status is kept, the order is not moved, and staff see the
 * line on the order timeline so the mismatch between the parcel and the order
 * can be reconciled by hand. The line is idempotent per parcel and courier
 * status, so a provider that redelivers the same update does not add another.
 */
export async function recordManualCodDepositReconciliationRequired(
    db: Database,
    input: {
        orderId: string;
        shipmentId: string;
        /** The courier's own status, kept on the parcel. */
        shipmentStatus: string;
        error: ManualCodDepositBlockedError;
    },
): Promise<void> {
    await recordOrderEvent(db, {
        orderId: input.orderId,
        kind: "deposit_reconciliation_required",
        body: input.error.message,
        data: {
            reason: "manual_cod_deposit_not_verified" satisfies DepositReconciliationReason,
            shipmentId: input.shipmentId,
            shipmentStatus: input.shipmentStatus,
        },
        requestKey: `deposit-reconciliation:${input.shipmentId}:${input.shipmentStatus}`,
    });
}
