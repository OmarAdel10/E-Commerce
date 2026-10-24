/**
 * What a delivery option costs for a cart: the one shipping-profile rule
 * (rules/decisions/2026-10-24-shipping-profiles.md).
 *
 * A cart's shipped lines (physical, never a gift card) fall into groups:
 * - a free profile's lines ship free and price nothing;
 * - a profile with its own rates behind the option is priced by them;
 * - every other line (the default profile's, and a profile without rates
 *   behind the option) is priced with the default profile: its rates behind
 *   the option, else the option's own fee and free-over amount.
 * A group's weight band, order-value band and free-over amount count only
 * its own lines. The cheapest rate whose bands hold applies; a group whose
 * rates all miss leaves the option unavailable for the cart. The charge is
 * the sum of the groups'. A line without a weight weighs its profile's
 * default weight (else the default profile's, else 0 g): it never voids
 * weight pricing for the rest of the cart.
 */
export const DEFAULT_SHIPPING_PROFILE_ID = "shp_default";

/** A profile's own price behind one delivery option (minor units of the cart's currency). */
export interface ProfileRateRow {
    profileId: string;
    feeMinor: number;
    minWeightGrams: number | null;
    maxWeightGrams: number | null;
    minSubtotalMinor: number | null;
    maxSubtotalMinor: number | null;
    freeOverMinor: number | null;
}

/** One shipped line as the rule reads it. */
export interface ShippingLine {
    /** Null: the default profile. */
    shippingProfileId: string | null;
    /** The line's profile ships free. */
    freeDelivery: boolean;
    /** Grams per unit, with the profile's (or store's) default already applied. */
    weightGrams: number;
    unitPriceMinor: number;
    quantity: number;
}

/** One group's share of an option's charge. */
export interface DeliveryShare {
    /** The profile whose rates priced the share (the default profile for the base group). */
    profileId: string;
    /** The rate's fee before its free-over amount. */
    baseMinor: number;
    /** The free-over amount made the share free. */
    waived: boolean;
    weightGrams: number;
    subtotalMinor: number;
}

export interface DeliveryOptionCharge {
    /** What the buyer pays: the shares' charges summed. */
    chargeMinor: number;
    /** The fees before free-over amounts. */
    baseMinor: number;
    /** Every share's free-over amount waived a fee: the order says the fee was waived. */
    waived: boolean;
    shares: DeliveryShare[];
}

/** The option's own price fields (the default profile's flat rate). */
export interface PricedDeliveryOption {
    feeMinor: number;
    freeOverMinor: number | null;
    profileRates?: readonly ProfileRateRow[] | null;
}

const within = (value: number, min: number | null, max: number | null) =>
    (min === null || value >= min) && (max === null || value <= max);

interface Group {
    profileId: string;
    rates: readonly ProfileRateRow[];
    weightGrams: number;
    subtotalMinor: number;
}

function cheapest(group: Group): DeliveryShare | null {
    let best: DeliveryShare | null = null;
    let bestCharge = Number.POSITIVE_INFINITY;
    for (const rate of group.rates) {
        if (!within(group.weightGrams, rate.minWeightGrams, rate.maxWeightGrams)) continue;
        if (!within(group.subtotalMinor, rate.minSubtotalMinor, rate.maxSubtotalMinor)) continue;
        const waived = rate.feeMinor > 0 && rate.freeOverMinor !== null && group.subtotalMinor >= rate.freeOverMinor;
        const charge = waived ? 0 : rate.feeMinor;
        if (charge < bestCharge || (charge === bestCharge && best !== null && rate.feeMinor < best.baseMinor)) {
            best = { profileId: group.profileId, baseMinor: rate.feeMinor, waived, weightGrams: group.weightGrams, subtotalMinor: group.subtotalMinor };
            bestCharge = charge;
        }
    }
    return best;
}

/** The lines of each priced group (the free profiles' lines price nothing). */
export function deliveryOptionGroups(
    option: Pick<PricedDeliveryOption, "profileRates">,
    lines: readonly ShippingLine[],
): Map<string, ShippingLine[]> {
    const rated = new Set((option.profileRates ?? []).map((rate) => rate.profileId));
    const groups = new Map<string, ShippingLine[]>();
    for (const line of lines) {
        if (line.freeDelivery) continue;
        const profile = line.shippingProfileId ?? DEFAULT_SHIPPING_PROFILE_ID;
        const key = profile !== DEFAULT_SHIPPING_PROFILE_ID && rated.has(profile) ? profile : DEFAULT_SHIPPING_PROFILE_ID;
        groups.set(key, [...(groups.get(key) ?? []), line]);
    }
    return groups;
}

/**
 * The lines the option's own fee prices: a carrier option quotes this parcel
 * (empty when the default profile has its own rates behind the option).
 */
export function deliveryOptionBaseLines(option: Pick<PricedDeliveryOption, "profileRates">, lines: readonly ShippingLine[]): ShippingLine[] {
    if ((option.profileRates ?? []).some((rate) => rate.profileId === DEFAULT_SHIPPING_PROFILE_ID)) return [];
    return deliveryOptionGroups(option, lines).get(DEFAULT_SHIPPING_PROFILE_ID) ?? [];
}

/** The option's charge for these shipped lines, or null when a group has no rate its lines meet. */
export function priceDeliveryOption(option: PricedDeliveryOption, lines: readonly ShippingLine[]): DeliveryOptionCharge | null {
    const profileRates = option.profileRates ?? [];
    const ratesOf = (profileId: string): readonly ProfileRateRow[] => {
        const own = profileRates.filter((rate) => rate.profileId === profileId);
        return own.length > 0
            ? own
            : [{ profileId, feeMinor: option.feeMinor, freeOverMinor: option.freeOverMinor, minWeightGrams: null, maxWeightGrams: null, minSubtotalMinor: null, maxSubtotalMinor: null }];
    };
    const totals = (groupLines: readonly ShippingLine[]) => ({
        weightGrams: groupLines.reduce((sum, line) => sum + line.weightGrams * line.quantity, 0),
        subtotalMinor: groupLines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0),
    });
    const shares: DeliveryShare[] = [];
    for (const [profileId, groupLines] of deliveryOptionGroups(option, lines)) {
        const share = cheapest({ profileId, rates: ratesOf(profileId), ...totals(groupLines) });
        if (!share) return null;
        shares.push(share);
    }
    // A free profile's lines ship free, never refused: their share is waived at
    // what the default profile's rate would charge them (the order shows the fee waived).
    const free = new Map<string, ShippingLine[]>();
    for (const line of lines) {
        if (!line.freeDelivery) continue;
        const profileId = line.shippingProfileId ?? DEFAULT_SHIPPING_PROFILE_ID;
        free.set(profileId, [...(free.get(profileId) ?? []), line]);
    }
    for (const [profileId, groupLines] of free) {
        const sized = totals(groupLines);
        const fee = cheapest({ profileId, rates: ratesOf(DEFAULT_SHIPPING_PROFILE_ID).map((rate) => ({ ...rate, freeOverMinor: null })), ...sized })?.baseMinor ?? 0;
        shares.push({ profileId, baseMinor: fee, waived: fee > 0, ...sized });
    }
    return summarizeDeliveryShares(shares);
}

/**
 * The shares as the order snapshots them: the charge, and the base fee the
 * order shows. A fully waived charge keeps its fees as the base (the order
 * says "৳120 delivery fee waived"); otherwise the base is the charge.
 */
export function summarizeDeliveryShares(shares: readonly DeliveryShare[]): DeliveryOptionCharge {
    const chargeMinor = shares.reduce((sum, share) => sum + (share.waived ? 0 : share.baseMinor), 0);
    const fees = shares.reduce((sum, share) => sum + share.baseMinor, 0);
    const waived = chargeMinor === 0 && fees > 0 && shares.some((share) => share.waived);
    return { chargeMinor, baseMinor: waived ? fees : chargeMinor, waived, shares: [...shares] };
}

/** A line's weight for shipping: its own, else its profile's default weight, else the store's, else 0 g. */
export function shippingWeightGrams(weightGrams: number | null | undefined, defaultWeightGrams: number | null | undefined): number {
    if (typeof weightGrams === "number" && Number.isFinite(weightGrams) && weightGrams >= 0) return weightGrams;
    if (typeof defaultWeightGrams === "number" && Number.isFinite(defaultWeightGrams) && defaultWeightGrams >= 0) return defaultWeightGrams;
    return 0;
}

/** A profile-rates column (`profileRatesJsonSql`) as rows; malformed entries are dropped. */
export function parseProfileRates(value: unknown): ProfileRateRow[] {
    if (Array.isArray(value)) return value as ProfileRateRow[];
    if (typeof value !== "string" || !value) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];
    const int = (entry: unknown): number | null => (typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0 ? entry : null);
    // The merchant's order (sort order, then id): group_concat keeps none.
    const ordered = [...parsed as Array<Record<string, unknown>>].sort((a, b) =>
        (Number(a?.s) || 0) - (Number(b?.s) || 0) || String(a?.i ?? "").localeCompare(String(b?.i ?? "")));
    return ordered.flatMap((entry: Record<string, unknown>) => {
        const feeMinor = int(entry?.f);
        if (typeof entry?.p !== "string" || feeMinor === null) return [];
        return [{
            profileId: entry.p,
            feeMinor,
            minWeightGrams: int(entry.wn),
            maxWeightGrams: int(entry.wx),
            minSubtotalMinor: int(entry.vn),
            maxSubtotalMinor: int(entry.vx),
            freeOverMinor: int(entry.fo),
        }];
    });
}
