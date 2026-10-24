/**
 * The delivery a return's items were charged, suggested with their refund
 * (the merchant edits it): the part of the order's delivery charge the
 * returned shipped lines account for under the shipping-profile rule. The
 * order keeps no per-profile shares, so the rule prices the order's shipped
 * lines with and without the returned units at the order's delivery option,
 * and the difference's proportion of that charge applies to what the order
 * actually charged. Every shipped unit returned: the whole charge.
 */
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Database } from "@scalius/database/client";
import {
    DEFAULT_SHIPPING_PROFILE_ID,
    orderItems,
    orderReturnLines,
    orderReturns,
    products,
    productVariants,
    shippingProfiles,
} from "@scalius/database/schema";
import {
    priceDeliveryOption,
    selectDeliveryRateRowsByIds,
    shippingWeightGrams,
    type PricedDeliveryOption,
    type ShippingLine,
} from "../../delivery";

export async function returnedDeliveryShareMinor(
    db: Database,
    order: { id: string; shippingAmountMinor: number; shippingMethodId: string | null },
): Promise<number> {
    if (order.shippingAmountMinor <= 0 || !order.shippingMethodId) return 0;
    const [items, returned, rates] = await Promise.all([
        db.select({
            id: orderItems.id,
            quantity: orderItems.quantity,
            unitPriceMinor: orderItems.unitPriceMinor,
            fulfillmentType: orderItems.fulfillmentType,
            profileId: products.shippingProfileId,
            freeDelivery: products.freeDelivery,
            weight: productVariants.weight,
            profileWeight: shippingProfiles.defaultWeightGrams,
        }).from(orderItems)
            .leftJoin(products, eq(products.id, orderItems.productId))
            .leftJoin(productVariants, eq(productVariants.id, orderItems.variantId))
            .leftJoin(shippingProfiles, eq(shippingProfiles.id, products.shippingProfileId))
            .where(and(eq(orderItems.orderId, order.id), eq(orderItems.fulfillmentType, "ship"))),
        db.select({ orderItemId: orderReturnLines.orderItemId, received: orderReturnLines.receivedQuantity })
            .from(orderReturnLines)
            .innerJoin(orderReturns, eq(orderReturns.id, orderReturnLines.returnId))
            .where(and(eq(orderReturnLines.orderId, order.id), notInArray(orderReturns.status, ["cancelled", "rejected"]))),
        selectDeliveryRateRowsByIds(db, [order.shippingMethodId]),
    ]);
    const rate = rates[0];
    if (!rate || items.length === 0) return 0;
    const storeWeight = (await db.select({ grams: shippingProfiles.defaultWeightGrams }).from(shippingProfiles)
        .where(inArray(shippingProfiles.id, [DEFAULT_SHIPPING_PROFILE_ID])).get())?.grams ?? null;
    const returnedOf = new Map<string, number>();
    for (const line of returned) returnedOf.set(line.orderItemId, (returnedOf.get(line.orderItemId) ?? 0) + line.received);
    return returnedDeliveryShare(rate, items.map((item) => ({
        shippingProfileId: item.profileId ?? null,
        freeDelivery: item.freeDelivery === true,
        weightGrams: shippingWeightGrams(item.weight, item.profileWeight ?? storeWeight),
        unitPriceMinor: item.unitPriceMinor,
        quantity: item.quantity,
        returned: Math.min(item.quantity, returnedOf.get(item.id) ?? 0),
    })), order.shippingAmountMinor);
}

/**
 * The share of `shippingAmountMinor` the returned units account for: the
 * option's charge for every shipped line less its charge for the lines kept,
 * as a proportion of the first; every unit returned: all of it.
 */
export function returnedDeliveryShare(
    rate: PricedDeliveryOption,
    lines: ReadonlyArray<ShippingLine & { returned: number }>,
    shippingAmountMinor: number,
): number {
    if (shippingAmountMinor <= 0 || !lines.some((line) => line.returned > 0)) return 0;
    const kept = lines.flatMap(({ returned, ...line }) => (line.quantity - returned > 0 ? [{ ...line, quantity: line.quantity - returned }] : []));
    if (kept.length === 0) return shippingAmountMinor;
    const all = priceDeliveryOption(rate, lines.map(({ returned: _returned, ...line }) => line))?.chargeMinor ?? 0;
    const rest = priceDeliveryOption(rate, kept)?.chargeMinor ?? all;
    if (all <= 0 || rest >= all) return 0;
    return Math.min(shippingAmountMinor, Math.round(shippingAmountMinor * (all - rest) / all));
}
