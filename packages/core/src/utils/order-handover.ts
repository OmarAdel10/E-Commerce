import { orderItems } from "@scalius/database/schema";
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/** Cancelling can release stock only while no units have been handed over. */
export function nothingHandedOverCondition(orderId: string | SQLWrapper): SQL {
    return sql`NOT EXISTS (
        SELECT 1 FROM ${orderItems}
        WHERE ${orderItems.orderId} = ${orderId}
          AND ${orderItems.fulfilledQuantity} > 0
    )`;
}
