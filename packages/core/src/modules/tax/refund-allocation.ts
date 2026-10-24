// Refund money is assigned to the immutable sale's lines before tax is
// reversed. Each line uses the change in its cumulative integer tax share,
// so splitting a refund cannot lose rounding units or tax an exempt line.
import { MAX_MINOR_AMOUNT } from "@scalius/shared/money";
import { allocateMinorAmount } from "./money";

export interface RefundTaxBucket {
    key: string;
    amountMinor: number;
    taxMinor: number;
    quantity: number;
}

export interface RefundTaxPart {
    key: string;
    amountMinor: number;
    taxMinor: number;
}

export interface RefundTaxAllocation {
    version: 1;
    groupId: string | null;
    parts: RefundTaxPart[];
    /** Quantity selection, shared by every tender payment in this refund group. */
    lines: Array<{ orderItemId: string; quantity: number }>;
    /** Goodwill beyond the named lines' sale value reverses no additional tax. */
    unallocatedAmountMinor: number;
}

function amount(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MINOR_AMOUNT) {
        throw new RangeError("Invalid refund tax amount.");
    }
    return value;
}

/** Parses only the durable allocation shape; malformed state must never reach the provider. */
export function readRefundTaxAllocation(raw: string): RefundTaxAllocation | { version: 0 } {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !("version" in value)) throw new RangeError("Invalid refund tax allocation.");
    if (value.version === 0) return { version: 0 };
    if (value.version !== 1 || !("parts" in value) || !Array.isArray(value.parts)
        || !("lines" in value) || !Array.isArray(value.lines)
        || !("groupId" in value) || (value.groupId !== null && typeof value.groupId !== "string")
        || !("unallocatedAmountMinor" in value) || typeof value.unallocatedAmountMinor !== "number") {
        throw new RangeError("Invalid refund tax allocation.");
    }
    const parts = value.parts.map((part: unknown): RefundTaxPart => {
        if (!part || typeof part !== "object" || !("key" in part) || typeof part.key !== "string"
            || !("amountMinor" in part) || typeof part.amountMinor !== "number"
            || !("taxMinor" in part) || typeof part.taxMinor !== "number") {
            throw new RangeError("Invalid refund tax allocation part.");
        }
        return { key: part.key, amountMinor: amount(part.amountMinor), taxMinor: amount(part.taxMinor) };
    });
    if (new Set(parts.map((part) => part.key)).size !== parts.length) throw new RangeError("Duplicate refund tax allocation part.");
    const lines = value.lines.map((line: unknown) => {
        if (!line || typeof line !== "object" || !("orderItemId" in line) || typeof line.orderItemId !== "string"
            || !("quantity" in line) || typeof line.quantity !== "number" || !Number.isSafeInteger(line.quantity) || line.quantity < 1) {
            throw new RangeError("Invalid refund tax quantity selection.");
        }
        return { orderItemId: line.orderItemId, quantity: line.quantity };
    });
    if (new Set(lines.map((line) => line.orderItemId)).size !== lines.length || (lines.length > 0 && value.groupId === null)) {
        throw new RangeError("Invalid refund tax quantity selection.");
    }
    return { version: 1, groupId: value.groupId, parts, lines, unallocatedAmountMinor: amount(value.unallocatedAmountMinor) };
}

/**
 * Largest-remainder money allocation followed by cumulative, exact BigInt
 * tax extraction. Named lines constrain eligibility; omitted lines allocate
 * over the remaining sale (shipping included). Each group shares its
 * quantity allowance across all of its tender payments.
 */
export function allocateRefundTax(input: {
    amountMinor: number;
    groupId: string | null;
    buckets: readonly RefundTaxBucket[];
    lines: readonly { orderItemId: string; quantity: number }[];
    prior: readonly RefundTaxAllocation[];
}): RefundTaxAllocation {
    const refundAmount = amount(input.amountMinor);
    const selected = new Map(input.lines.map((line) => [line.orderItemId, line.quantity]));
    if (selected.size !== input.lines.length) throw new RangeError("Duplicate refund line.");
    if (selected.size > 0 && input.groupId === null) throw new RangeError("Named refund lines need a group.");
    const spent = new Map<string, RefundTaxPart>();
    const groupSpent = new Map<string, number>();
    const returnedQuantities = new Map<string, number>();
    const countedGroups = new Set<string>();
    for (const allocation of input.prior) {
        if (allocation.groupId !== null && allocation.groupId !== input.groupId && !countedGroups.has(allocation.groupId)) {
            for (const line of allocation.lines) {
                returnedQuantities.set(line.orderItemId, (returnedQuantities.get(line.orderItemId) ?? 0) + line.quantity);
            }
            countedGroups.add(allocation.groupId);
        }
        for (const part of allocation.parts) {
            const previous = spent.get(part.key) ?? { key: part.key, amountMinor: 0, taxMinor: 0 };
            previous.amountMinor = amount(previous.amountMinor + amount(part.amountMinor));
            previous.taxMinor = amount(previous.taxMinor + amount(part.taxMinor));
            spent.set(part.key, previous);
            if (input.groupId !== null && allocation.groupId === input.groupId) {
                groupSpent.set(part.key, amount((groupSpent.get(part.key) ?? 0) + part.amountMinor));
            }
        }
    }
    if (new Set(input.buckets.map((bucket) => bucket.key)).size !== input.buckets.length) throw new RangeError("Duplicate refund tax bucket.");
    const weights = input.buckets.map((bucket) => {
        amount(bucket.amountMinor);
        amount(bucket.taxMinor);
        if (bucket.taxMinor > bucket.amountMinor || !Number.isSafeInteger(bucket.quantity) || bucket.quantity <= 0) {
            throw new RangeError("Invalid sale tax bucket.");
        }
        const previous = spent.get(bucket.key);
        const remaining = bucket.amountMinor - (previous?.amountMinor ?? 0);
        if (remaining < 0 || (previous?.taxMinor ?? 0) > bucket.taxMinor) throw new RangeError("Refund exceeds sale tax bucket.");
        let eligible = remaining;
        if (selected.size > 0) {
            const quantity = selected.get(bucket.key) ?? 0;
            if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > bucket.quantity) throw new RangeError("Invalid refund quantity.");
            // Ceiling makes the final quantity able to consume a residual
            // unit; the global remaining balance prevents double allocation.
            const quota = Number((BigInt(bucket.amountMinor) * BigInt(quantity) + BigInt(bucket.quantity) - 1n) / BigInt(bucket.quantity));
            const finalQuantity = quantity > 0 && (returnedQuantities.get(bucket.key) ?? 0) + quantity >= bucket.quantity;
            // Earlier quantity refunds may have rounded down. The last
            // returned quantity owns the actual remaining sale value.
            eligible = finalQuantity ? remaining : Math.min(remaining, Math.max(0, quota - (groupSpent.get(bucket.key) ?? 0)));
        }
        return { key: bucket.key, weightMinor: eligible };
    });
    if ([...selected.keys()].some((key) => !input.buckets.some((bucket) => bucket.key === key))) {
        throw new RangeError("Unknown refund line.");
    }
    const shares = allocateMinorAmount(refundAmount, weights);
    const parts = input.buckets.flatMap((bucket): RefundTaxPart[] => {
        const share = shares.get(bucket.key) ?? 0;
        if (share === 0) return [];
        const previous = spent.get(bucket.key);
        const cumulativeTax = bucket.amountMinor === 0 ? 0 : Number(
            BigInt((previous?.amountMinor ?? 0) + share) * BigInt(bucket.taxMinor) / BigInt(bucket.amountMinor),
        );
        // An old already-issued under-reversal cannot turn a one-unit
        // refund into a larger tax-only correction under the existing port.
        return [{ key: bucket.key, amountMinor: share, taxMinor: Math.min(share, Math.max(0, cumulativeTax - (previous?.taxMinor ?? 0))) }];
    });
    return {
        version: 1,
        groupId: input.groupId,
        parts,
        lines: input.lines.map((line) => ({ ...line })),
        unallocatedAmountMinor: refundAmount - parts.reduce((sum, part) => sum + part.amountMinor, 0),
    };
}
