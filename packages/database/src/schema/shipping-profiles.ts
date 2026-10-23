// src/db/schema/shipping-profiles.ts
// Shipping profiles (migration 0185, rules/decisions/2026-10-24-shipping-profiles.md):
// groups of products with their own delivery prices. A store's delivery
// options stay its zones' rates (`shipping_methods`); a profile can put its
// own prices behind an option (`shipping_profile_rates`).

import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";
import type { InferSelectModel } from "drizzle-orm";
import { UNIX_NOW } from "./shared";
import { shippingMethods } from "./delivery";

/** The profile every product without one belongs to; seeded, never deleted, never free. */
export const DEFAULT_SHIPPING_PROFILE_ID = "shp_default";
/** The free-delivery profile migration 0185 seeds for products that had free delivery. */
export const FREE_DELIVERY_SHIPPING_PROFILE_ID = "shp_free_delivery";

/**
 * A shipping profile. A free profile's products ship free on every delivery
 * option (it has no rates; fixed when the profile is created, a trigger
 * refuses a change). `products.free_delivery` mirrors its product's profile
 * (a trigger refuses a product row that disagrees). A line without a weight
 * weighs the profile's default weight, else the default profile's, else 0.
 */
export const shippingProfiles = sqliteTable("shipping_profiles", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    freeDelivery: integer("free_delivery", { mode: "boolean" }).notNull().default(false),
    /** Grams a line of this profile weighs when its SKU has no weight. */
    defaultWeightGrams: integer("default_weight_grams"),
    /** Advances on every edit; a stale edit is rejected (409). */
    revision: integer("revision").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" })
        .notNull()
        .default(UNIX_NOW),
    updatedAt: integer("updated_at", { mode: "timestamp" })
        .notNull()
        .default(UNIX_NOW),
}, (table) => [
    uniqueIndex("shipping_profiles_name_uidx").on(sql`lower(trim(${table.name}))`),
    check("shipping_profiles_free_delivery_check", sql`${table.freeDelivery} IN (0, 1)`),
    check("shipping_profiles_default_not_free", sql`${table.id} <> 'shp_default' OR ${table.freeDelivery} = 0`),
    check("shipping_profiles_default_weight_range", sql`${table.defaultWeightGrams} IS NULL OR (${table.defaultWeightGrams} >= 0 AND ${table.defaultWeightGrams} <= 1000000)`),
    check("shipping_profiles_name_shape", sql`length(trim(${table.name})) BETWEEN 1 AND 80`),
]);

/**
 * A profile's own price behind one delivery option. The cheapest rate whose
 * conditions the profile's shipped lines meet applies: a weight band and an
 * order-value band (bounds inclusive, null = open), and a free-over amount
 * that counts only those lines. A profile with no rate behind an option is
 * priced with the default profile's lines; the default profile's rates
 * replace the option's own fee and free-over. A profile whose rates behind an
 * option all miss leaves the option unavailable for that cart.
 */
export const shippingProfileRates = sqliteTable("shipping_profile_rates", {
    id: text("id").primaryKey(),
    methodId: text("method_id")
        .notNull()
        .references(() => shippingMethods.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
        .notNull()
        .references(() => shippingProfiles.id, { onDelete: "cascade" }),
    /** Integer minor units of the store currency. */
    feeMinor: integer("fee_minor").notNull(),
    minWeightGrams: integer("min_weight_grams"),
    maxWeightGrams: integer("max_weight_grams"),
    minSubtotalMinor: integer("min_subtotal_minor"),
    maxSubtotalMinor: integer("max_subtotal_minor"),
    /** Free once this profile's shipped lines reach it (before discounts); minor units. */
    freeOverMinor: integer("free_over_minor"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
        .notNull()
        .default(UNIX_NOW),
}, (table) => [
    index("shipping_profile_rates_method_idx").on(table.methodId, table.profileId),
    index("shipping_profile_rates_profile_idx").on(table.profileId),
    check("shipping_profile_rates_amounts", sql`${table.feeMinor} >= 0 AND (${table.freeOverMinor} IS NULL OR ${table.freeOverMinor} >= 0)`),
    check("shipping_profile_rates_weight_band", sql`(${table.minWeightGrams} IS NULL OR ${table.minWeightGrams} >= 0) AND (${table.maxWeightGrams} IS NULL OR ${table.maxWeightGrams} >= 0) AND (${table.minWeightGrams} IS NULL OR ${table.maxWeightGrams} IS NULL OR ${table.minWeightGrams} <= ${table.maxWeightGrams})`),
    check("shipping_profile_rates_value_band", sql`(${table.minSubtotalMinor} IS NULL OR ${table.minSubtotalMinor} >= 0) AND (${table.maxSubtotalMinor} IS NULL OR ${table.maxSubtotalMinor} >= 0) AND (${table.minSubtotalMinor} IS NULL OR ${table.maxSubtotalMinor} IS NULL OR ${table.minSubtotalMinor} <= ${table.maxSubtotalMinor})`),
]);

export type ShippingProfile = InferSelectModel<typeof shippingProfiles>;
export type ShippingProfileRate = InferSelectModel<typeof shippingProfileRates>;
