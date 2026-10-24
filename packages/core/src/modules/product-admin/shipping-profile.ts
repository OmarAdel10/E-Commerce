// A product's shipping profile on a write (rules/decisions/2026-10-24-shipping-profiles.md).
// The profile is the authority; `products.free_delivery` is its mirror, so
// every write sets both (a database trigger refuses a row that disagrees).
// `freeDelivery` is the deprecated alias older callers (imports, agents)
// still send: true puts the product in the store's free-delivery profile,
// false takes it out of a free profile.
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@scalius/database/client";
import {
    DEFAULT_SHIPPING_PROFILE_ID,
    FREE_DELIVERY_SHIPPING_PROFILE_ID,
    shippingProfiles,
} from "@scalius/database/schema";
import { ValidationError } from "@scalius/core/errors";

export interface ProductShippingProfileWrite {
    /** Null: the default profile. */
    shippingProfileId: string | null;
    freeDelivery: boolean;
    /** The store has no free profile yet: the write creates `shp_free_delivery` first. */
    createFreeProfile: boolean;
}

/**
 * The profile columns a product write sets, or undefined to leave them as
 * they are. `current` is the stored product (absent for a new one).
 */
export async function resolveProductShippingProfile(
    db: Database,
    input: { shippingProfileId?: string | null; freeDelivery?: boolean },
    current?: { shippingProfileId: string | null; freeDelivery: boolean },
): Promise<ProductShippingProfileWrite | undefined> {
    const keep = { shippingProfileId: current?.shippingProfileId ?? null, freeDelivery: current?.freeDelivery ?? false, createFreeProfile: false };
    if (input.shippingProfileId !== undefined) {
        const id = input.shippingProfileId?.trim() || null;
        if (id === null || id === DEFAULT_SHIPPING_PROFILE_ID) return { shippingProfileId: null, freeDelivery: false, createFreeProfile: false };
        const profile = await db.select({ id: shippingProfiles.id, freeDelivery: shippingProfiles.freeDelivery })
            .from(shippingProfiles).where(eq(shippingProfiles.id, id)).get();
        if (!profile) {
            const message = "Choose a shipping profile from the list.";
            throw new ValidationError(message, { issues: [{ path: ["shippingProfileId"], message }] });
        }
        return { shippingProfileId: profile.id, freeDelivery: profile.freeDelivery, createFreeProfile: false };
    }
    if (input.freeDelivery === undefined) return current ? undefined : keep;
    if (input.freeDelivery === (current?.freeDelivery ?? false)) return current ? undefined : keep;
    if (!input.freeDelivery) return { shippingProfileId: null, freeDelivery: false, createFreeProfile: false };
    const free = await db.select({ id: shippingProfiles.id }).from(shippingProfiles)
        .where(eq(shippingProfiles.freeDelivery, true))
        .orderBy(desc(sql`${shippingProfiles.id} = ${FREE_DELIVERY_SHIPPING_PROFILE_ID}`), asc(shippingProfiles.createdAt), asc(shippingProfiles.id))
        .limit(1)
        .get();
    return { shippingProfileId: free?.id ?? FREE_DELIVERY_SHIPPING_PROFILE_ID, freeDelivery: true, createFreeProfile: !free };
}

/** Creates the free-delivery profile when the store has none (the alias's first use). */
export function createFreeShippingProfileStatement(db: Database) {
    return db.insert(shippingProfiles)
        .values({ id: FREE_DELIVERY_SHIPPING_PROFILE_ID, name: "Free delivery", freeDelivery: true })
        .onConflictDoNothing();
}
