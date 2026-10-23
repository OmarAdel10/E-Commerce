// The distinct fulfilment types of an order's lines, read as one column of the
// order's own statement: whether cash (and so a deposit plan) fits the order
// (`allowsCashOnDelivery`, @scalius/shared/fulfilment).
import { sql, type SQL } from "drizzle-orm";
import { orderItems, orders } from "@scalius/database/schema";
import { isFulfillmentType, type FulfillmentType } from "@scalius/shared/fulfilment";

/** Comma-joined distinct line types of the `orders` row the statement reads. */
export function orderLineTypesSql(): SQL<string | null> {
    return sql<string | null>`(SELECT group_concat(order_line_type.fulfillment_type, ',') FROM (
        SELECT DISTINCT ${orderItems.fulfillmentType} AS fulfillment_type FROM ${orderItems}
        WHERE ${orderItems.orderId} = ${orders.id}) AS order_line_type)`;
}

/** The column `orderLineTypesSql()` read; unknown values are dropped. */
export function parseOrderLineTypes(value: string | null | undefined): FulfillmentType[] {
    return (value ?? "").split(",").filter(isFulfillmentType);
}
