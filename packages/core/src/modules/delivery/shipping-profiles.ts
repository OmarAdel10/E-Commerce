/**
 * Shipping profiles in the dashboard (rules/decisions/2026-10-24-shipping-profiles.md).
 *
 * A store always has the default profile (General); every product without a
 * profile is in it. A profile is free (its products ship free on every
 * delivery option; fixed at creation) or priced: behind each delivery
 * option it can have its own rates, each with an optional weight band,
 * order-value band and free-over amount. Without its own rates behind an
 * option, a profile's products are priced with the default profile's. The
 * pricing rule itself is `priceDeliveryOption` (profile-pricing.ts).
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { nanoid } from "nanoid";
import { buildBatchGuard, isBatchGuardError, safeBatch, type Database } from "@scalius/database/client";
import {
    DEFAULT_SHIPPING_PROFILE_ID,
    products,
    shippingMethods,
    shippingProfileRates,
    shippingProfiles,
} from "@scalius/database/schema";
import { fromMinor, isIncrementMultipleMinor, priceIncrementMessage, toMinor } from "@scalius/shared/money";
import { ConflictError, NotFoundError, ValidationError } from "@scalius/core/errors";
import { SettingsRevisionConflictError } from "../../settings-store";
import type { StoreCurrency } from "../settings";
import { MAX_DELIVERY_AMOUNT } from "./zones";

type Statement = BatchItem<"sqlite">;

/** Profiles a store may have, and rates one profile may set across its options. */
export const MAX_SHIPPING_PROFILES = 20;
export const MAX_PROFILE_RATES = 200;
/** Heaviest band bound and default weight, in grams (1,000 kg). */
export const MAX_SHIPPING_WEIGHT_GRAMS = 1_000_000;

const RATE_CHUNK = 10;
const now = sql`(cast(strftime('%s','now') as int))`;
const PROFILE_REVISION_GUARD = "SHIPPING_PROFILE_REVISION_GUARD";

export interface ShippingProfileRateView {
    id: string;
    /** The delivery option (a zone's rate, or local pickup) the rate prices for this profile. */
    methodId: string;
    fee: number;
    minWeightGrams: number | null;
    maxWeightGrams: number | null;
    minSubtotal: number | null;
    maxSubtotal: number | null;
    freeOver: number | null;
}

export interface ShippingProfileView {
    id: string;
    name: string;
    isDefault: boolean;
    freeDelivery: boolean;
    defaultWeightGrams: number | null;
    revision: number;
    /** Live products in the profile (the default profile: every product without one). */
    productCount: number;
    rates: ShippingProfileRateView[];
}

export async function listShippingProfiles(db: Database, decimalPlaces: number): Promise<ShippingProfileView[]> {
    const [profiles, rates, counts] = await Promise.all([
        db.select().from(shippingProfiles).orderBy(sql`${shippingProfiles.id} <> ${DEFAULT_SHIPPING_PROFILE_ID}`, asc(shippingProfiles.createdAt), asc(shippingProfiles.id)),
        db.select().from(shippingProfileRates)
            .innerJoin(shippingMethods, eq(shippingMethods.id, shippingProfileRates.methodId))
            .where(isNull(shippingMethods.deletedAt))
            .orderBy(asc(shippingProfileRates.sortOrder), asc(shippingProfileRates.id)),
        db.select({ profileId: sql<string>`coalesce(${products.shippingProfileId}, ${DEFAULT_SHIPPING_PROFILE_ID})`, count: sql<number>`count(*)` })
            .from(products)
            .where(isNull(products.deletedAt))
            .groupBy(sql`coalesce(${products.shippingProfileId}, ${DEFAULT_SHIPPING_PROFILE_ID})`),
    ]);
    const money = (minor: number | null) => (minor === null ? null : fromMinor(minor, decimalPlaces));
    return profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        isDefault: profile.id === DEFAULT_SHIPPING_PROFILE_ID,
        freeDelivery: profile.freeDelivery,
        defaultWeightGrams: profile.defaultWeightGrams ?? null,
        revision: profile.revision,
        productCount: Number(counts.find((row) => row.profileId === profile.id)?.count ?? 0),
        rates: rates
            .filter((row) => row.shipping_profile_rates.profileId === profile.id)
            .map(({ shipping_profile_rates: rate }) => ({
                id: rate.id,
                methodId: rate.methodId,
                fee: fromMinor(rate.feeMinor, decimalPlaces),
                minWeightGrams: rate.minWeightGrams ?? null,
                maxWeightGrams: rate.maxWeightGrams ?? null,
                minSubtotal: money(rate.minSubtotalMinor ?? null),
                maxSubtotal: money(rate.maxSubtotalMinor ?? null),
                freeOver: money(rate.freeOverMinor ?? null),
            })),
    }));
}

/** A profile rate as the dashboard sends it; amounts are decimal major units. */
export interface ShippingProfileRateInput {
    methodId: string;
    fee: number;
    minWeightGrams?: number | null;
    maxWeightGrams?: number | null;
    minSubtotal?: number | null;
    maxSubtotal?: number | null;
    freeOver?: number | null;
}

export interface ShippingProfileInput {
    name: string;
    defaultWeightGrams?: number | null;
    rates?: ShippingProfileRateInput[];
}

interface Issue {
    path: Array<string | number>;
    message: string;
}

function throwIssues(issues: readonly Issue[]): void {
    if (issues.length > 0) throw new ValidationError(issues[0]!.message, { issues });
}

function amountToMinor(value: number, currency: StoreCurrency, path: Issue["path"], issues: Issue[]): number {
    if (!Number.isFinite(value) || value < 0 || value > MAX_DELIVERY_AMOUNT) {
        issues.push({ path, message: "Enter an amount from 0 to 1,00,000." });
        return 0;
    }
    const minor = toMinor(value, currency.decimalPlaces);
    if (fromMinor(minor, currency.decimalPlaces) !== value) {
        issues.push({ path, message: `Use up to ${currency.decimalPlaces} decimal places.` });
    } else if (!isIncrementMultipleMinor(minor, currency.priceIncrementMinor)) {
        issues.push({ path, message: priceIncrementMessage(currency.code, currency.priceIncrementMinor) });
    }
    return minor;
}

function gramsOf(value: number | null | undefined, path: Issue["path"], issues: Issue[]): number | null {
    if (value === null || value === undefined) return null;
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SHIPPING_WEIGHT_GRAMS) {
        issues.push({ path, message: "Enter whole grams from 0 to 1,000,000." });
        return null;
    }
    return value;
}

function parseName(name: string, issues: Issue[]): string {
    const trimmed = name.trim();
    if (!trimmed) issues.push({ path: ["name"], message: "Enter a profile name." });
    else if (trimmed.length > 80) issues.push({ path: ["name"], message: "Use 80 characters or fewer." });
    return trimmed;
}

function parseRates(rates: readonly ShippingProfileRateInput[], currency: StoreCurrency, issues: Issue[]) {
    if (rates.length > MAX_PROFILE_RATES) issues.push({ path: ["rates"], message: `Use ${MAX_PROFILE_RATES} rates or fewer.` });
    return rates.map((rate, index) => {
        const path = (field: string) => ["rates", index, field];
        const minSubtotal = rate.minSubtotal ?? null;
        const maxSubtotal = rate.maxSubtotal ?? null;
        const freeOver = rate.freeOver ?? null;
        const parsed = {
            methodId: rate.methodId.trim(),
            feeMinor: amountToMinor(rate.fee, currency, path("fee"), issues),
            minWeightGrams: gramsOf(rate.minWeightGrams, path("minWeightGrams"), issues),
            maxWeightGrams: gramsOf(rate.maxWeightGrams, path("maxWeightGrams"), issues),
            minSubtotalMinor: minSubtotal === null ? null : amountToMinor(minSubtotal, currency, path("minSubtotal"), issues),
            maxSubtotalMinor: maxSubtotal === null ? null : amountToMinor(maxSubtotal, currency, path("maxSubtotal"), issues),
            freeOverMinor: freeOver === null ? null : amountToMinor(freeOver, currency, path("freeOver"), issues),
        };
        if (parsed.minWeightGrams !== null && parsed.maxWeightGrams !== null && parsed.minWeightGrams > parsed.maxWeightGrams) {
            issues.push({ path: path("maxWeightGrams"), message: "Make the heaviest weight at least the lightest." });
        }
        if (parsed.minSubtotalMinor !== null && parsed.maxSubtotalMinor !== null && parsed.minSubtotalMinor > parsed.maxSubtotalMinor) {
            issues.push({ path: path("maxSubtotal"), message: "Make the highest order value at least the lowest." });
        }
        return parsed;
    });
}

/** Every rate names a live delivery option. */
async function assertLiveMethods(db: Database, methodIds: readonly string[]): Promise<void> {
    const unique = [...new Set(methodIds)];
    if (unique.length === 0) return;
    const live = new Set<string>();
    for (let start = 0; start < unique.length; start += 90) {
        const rows = await db.select({ id: shippingMethods.id }).from(shippingMethods)
            .where(and(inArray(shippingMethods.id, unique.slice(start, start + 90)), isNull(shippingMethods.deletedAt)));
        for (const row of rows) live.add(row.id);
    }
    const index = methodIds.findIndex((id) => !live.has(id));
    if (index >= 0) {
        const message = "That delivery option no longer exists. Reload and choose again.";
        throw new ValidationError(message, { issues: [{ path: ["rates", index, "methodId"], message }] });
    }
}

function rethrowNameConflict(error: unknown): never {
    if (error instanceof Error && /UNIQUE|unique constraint|duplicate key/i.test(error.message)) {
        const message = "Use a different name for each shipping profile.";
        throw new ValidationError(message, { issues: [{ path: ["name"], message }] });
    }
    throw error;
}

function rateInsertStatements(db: Database, profileId: string, rates: ReturnType<typeof parseRates>): Statement[] {
    const statements: Statement[] = [];
    for (let start = 0; start < rates.length; start += RATE_CHUNK) {
        statements.push(db.insert(shippingProfileRates).values(rates.slice(start, start + RATE_CHUNK).map((rate, offset) => ({
            id: `spr_${nanoid()}`,
            profileId,
            sortOrder: start + offset,
            ...rate,
        }))));
    }
    return statements;
}

/** Creates a profile; `freeDelivery` is fixed for its life (a free profile takes no rates). */
export async function createShippingProfile(
    db: Database,
    input: ShippingProfileInput & { freeDelivery?: boolean },
    currency: StoreCurrency,
): Promise<{ id: string; revision: number }> {
    const issues: Issue[] = [];
    const name = parseName(input.name, issues);
    const defaultWeightGrams = gramsOf(input.defaultWeightGrams, ["defaultWeightGrams"], issues);
    const rates = parseRates(input.rates ?? [], currency, issues);
    if (input.freeDelivery && rates.length > 0) issues.push({ path: ["rates"], message: "A free delivery profile has no rates: its products ship free." });
    throwIssues(issues);
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(shippingProfiles) as [{ count: number }];
    if (Number(count) >= MAX_SHIPPING_PROFILES) throw new ValidationError(`A store can have ${MAX_SHIPPING_PROFILES} shipping profiles.`);
    await assertLiveMethods(db, rates.map((rate) => rate.methodId));
    const id = `shp_${nanoid()}`;
    try {
        await safeBatch(db, [
            db.insert(shippingProfiles).values({ id, name, freeDelivery: input.freeDelivery === true, defaultWeightGrams }),
            ...rateInsertStatements(db, id, rates),
        ] as never);
    } catch (error) {
        rethrowNameConflict(error);
    }
    return { id, revision: 1 };
}

/** Replaces a profile's name, default weight and rates against the revision the editor loaded. */
export async function updateShippingProfile(
    db: Database,
    id: string,
    input: ShippingProfileInput,
    expectedRevision: number,
    currency: StoreCurrency,
): Promise<{ id: string; revision: number }> {
    const current = await db.select({ revision: shippingProfiles.revision, freeDelivery: shippingProfiles.freeDelivery })
        .from(shippingProfiles).where(eq(shippingProfiles.id, id)).get();
    if (!current) throw new NotFoundError("Shipping profile not found");
    if (current.revision !== expectedRevision) throw new SettingsRevisionConflictError("shipping_profile", expectedRevision, current.revision);
    const issues: Issue[] = [];
    const name = parseName(input.name, issues);
    const defaultWeightGrams = gramsOf(input.defaultWeightGrams, ["defaultWeightGrams"], issues);
    const rates = parseRates(input.rates ?? [], currency, issues);
    if (current.freeDelivery && rates.length > 0) issues.push({ path: ["rates"], message: "A free delivery profile has no rates: its products ship free." });
    throwIssues(issues);
    await assertLiveMethods(db, rates.map((rate) => rate.methodId));
    try {
        await safeBatch(db, [
            buildBatchGuard(db, sql`EXISTS (SELECT 1 FROM shipping_profiles WHERE id = ${id} AND revision = ${expectedRevision})`, PROFILE_REVISION_GUARD),
            db.update(shippingProfiles)
                .set({ name, defaultWeightGrams, revision: expectedRevision + 1, updatedAt: now })
                .where(eq(shippingProfiles.id, id)),
            ...(input.rates !== undefined
                ? [db.delete(shippingProfileRates).where(eq(shippingProfileRates.profileId, id)), ...rateInsertStatements(db, id, rates)]
                : []),
        ] as never);
    } catch (error) {
        if (isBatchGuardError(error, PROFILE_REVISION_GUARD)) {
            const latest = await db.select({ revision: shippingProfiles.revision }).from(shippingProfiles).where(eq(shippingProfiles.id, id)).get();
            throw new SettingsRevisionConflictError("shipping_profile", expectedRevision, latest?.revision ?? 0);
        }
        rethrowNameConflict(error);
    }
    return { id, revision: expectedRevision + 1 };
}

/** Deletes a profile: its products move to the default profile, its rates go with it. */
export async function deleteShippingProfile(db: Database, id: string): Promise<void> {
    if (id === DEFAULT_SHIPPING_PROFILE_ID) throw new ConflictError("The default shipping profile can't be deleted.");
    const existing = await db.select({ id: shippingProfiles.id }).from(shippingProfiles).where(eq(shippingProfiles.id, id)).get();
    if (!existing) throw new NotFoundError("Shipping profile not found");
    await safeBatch(db, [
        // The default profile ships nothing free, so its products' mirror is 0.
        db.update(products).set({ shippingProfileId: null, freeDelivery: false }).where(eq(products.shippingProfileId, id)),
        db.delete(shippingProfiles).where(eq(shippingProfiles.id, id)),
    ] as never);
}
