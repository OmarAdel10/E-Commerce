import { MAX_MINOR_AMOUNT } from "@scalius/shared/money";
import { allocateProportionalMinor } from "@scalius/shared/money-allocation";

function assertMinorAmount(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MINOR_AMOUNT) {
        throw new RangeError(`${label} must be a safe non-negative minor-unit integer.`);
    }
    return value;
}

/**
 * `amountMinor × rateBps`, rounded half-up to `unitMinor` (the market's price
 * increment: 100 keeps tax in whole taka; 1 keeps full minor-unit precision).
 */
export function multiplyMinorByRate(amountMinor: number, rateBps: number, unitMinor = 1): number {
    assertMinorAmount(amountMinor, "Tax base");
    if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
        throw new RangeError("Tax rate must be an integer between 0 and 10000 basis points.");
    }
    const unit = BigInt(unitMinor);
    const numerator = BigInt(amountMinor) * BigInt(rateBps);
    const rounded = ((numerator + 5_000n * unit) / (10_000n * unit)) * unit;
    const result = Number(rounded);
    return assertMinorAmount(result, "Tax amount");
}

/** Half-up to a multiple of `unitMinor`. */
export function roundToUnit(amountMinor: number, unitMinor: number): number {
    return unitMinor <= 1 ? amountMinor : Math.floor((amountMinor + unitMinor / 2) / unitMinor) * unitMinor;
}

export interface AllocationWeight {
    key: string;
    weightMinor: number;
}

/**
 * Splits an amount over exact proportional weights. Unlike discount weights,
 * these are ratios, not monetary caps: a rate share can be arbitrarily small.
 * Allocate whole increments before restoring minor units so no component is
 * independently rounded or made negative to reconcile the total.
 */
export function allocateWeightedMinorAmount(
    amountMinor: number,
    weights: ReadonlyArray<{ key: string; weight: bigint }>,
    unitMinor = 1,
): Map<string, number> {
    assertMinorAmount(amountMinor, "Allocation amount");
    if (new Set(weights.map(({ key }) => key)).size !== weights.length) {
        throw new RangeError("Allocation keys must be unique.");
    }
    const allocations = new Map(weights.map(({ key }) => [key, 0]));
    const ordered = [...weights].sort((left, right) => left.key.localeCompare(right.key));
    const shares = allocateProportionalMinor(amountMinor, ordered.map(({ weight }) => weight), unitMinor);
    ordered.forEach(({ key }, index) => allocations.set(key, shares[index]!));
    return allocations;
}

/**
 * Allocates a bounded amount proportionally with largest-remainder rounding.
 * Stable key ordering resolves exact remainder ties, making retries identical.
 */
export function allocateMinorAmount(
    amountMinor: number,
    weights: AllocationWeight[],
    unitMinor = 1,
): Map<string, number> {
    // Whole increments over whole-increment weights stay whole (whole taka: no paisa per line).
    if (unitMinor > 1 && amountMinor % unitMinor === 0 && weights.every(({ weightMinor }) => weightMinor % unitMinor === 0)) {
        const units = allocateMinorAmount(
            amountMinor / unitMinor,
            weights.map(({ key, weightMinor }) => ({ key, weightMinor: weightMinor / unitMinor })),
        );
        return new Map([...units].map(([key, part]) => [key, part * unitMinor]));
    }
    assertMinorAmount(amountMinor, "Allocation amount");
    const normalized = weights.map((entry) => ({
        key: entry.key,
        weightMinor: assertMinorAmount(entry.weightMinor, `Allocation weight ${entry.key}`),
    }));
    const totalWeight = normalized.reduce((sum, entry) => sum + entry.weightMinor, 0);
    if (!Number.isSafeInteger(totalWeight) || totalWeight < 0) {
        throw new RangeError("Allocation weights exceed the safe integer range.");
    }

    return allocateWeightedMinorAmount(
        Math.min(amountMinor, totalWeight),
        normalized.map(({ key, weightMinor }) => ({ key, weight: BigInt(weightMinor) })),
    );
}
