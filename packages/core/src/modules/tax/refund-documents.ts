import type { Database } from "@scalius/database/client";
import { orderItems, orderPayments, orderRefundLines, orders, orderTaxSnapshots, taxDocumentCommands, type TaxDocumentCommand } from "@scalius/database/schema";
import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { ProviderError } from "@scalius/shared/plugins/providers";
import { allocateMinorAmount } from "./money";
import { allocateRefundTax, readRefundTaxAllocation, type RefundTaxAllocation, type RefundTaxBucket } from "./refund-allocation";

function refundGroupId(metadata: string | null): string | null {
    if (metadata === null) return null;
    const parsed: unknown = JSON.parse(metadata);
    return parsed !== null && typeof parsed === "object" && "refundGroupId" in parsed && typeof parsed.refundGroupId === "string"
        ? parsed.refundGroupId : null;
}

/**
 * Allocates before dispatch under the same lease as the command. The claim
 * admits only the first unallocated refund of an order; the persisted
 * snapshot, not provider completion, frees the next refund to allocate.
 */
export async function allocateTaxDocumentRefund(db: Database, row: TaxDocumentCommand): Promise<boolean> {
    if (row.operation !== "refund") return true;
    if (row.allocationSnapshot !== null) {
        // A retry must reuse its exact original provider input. Legacy sent
        // commands retain their amounts; version zero is deliberately explicit.
        const allocation = readRefundTaxAllocation(row.allocationSnapshot);
        if (allocation.version === 1 && (allocation.parts.reduce((sum, part) => sum + part.taxMinor, 0) !== row.taxMinor
            || allocation.parts.reduce((sum, part) => sum + part.amountMinor, allocation.unallocatedAmountMinor) !== row.amountMinor)) {
            throw new RangeError("Refund tax snapshot does not match its command.");
        }
        return true;
    }
    const [saleRows, items, payments, lines, priorRows] = await db.batch([
        db.select({
            totalMinor: orders.totalAmountMinor,
            taxMinor: orders.taxAmountMinor,
            pricesIncludeTax: orderTaxSnapshots.pricesIncludeTax,
        }).from(orders).innerJoin(orderTaxSnapshots, eq(orderTaxSnapshots.orderId, orders.id)).where(eq(orders.id, row.orderId)),
        db.select({
            key: orderItems.id, quantity: orderItems.quantity,
            subtotalMinor: orderItems.lineSubtotalMinor,
            discountMinor: orderItems.discountAmountMinor,
            taxMinor: orderItems.taxAmountMinor,
        }).from(orderItems).where(eq(orderItems.orderId, row.orderId)),
        db.select({ id: orderPayments.id, metadata: orderPayments.metadata }).from(orderPayments)
            .where(and(eq(orderPayments.orderId, row.orderId), eq(orderPayments.paymentType, "refund"))),
        db.select({ refundId: orderRefundLines.refundId, orderItemId: orderRefundLines.orderItemId, quantity: orderRefundLines.quantity })
            .from(orderRefundLines).where(eq(orderRefundLines.orderId, row.orderId)),
        db.select({
            refundId: taxDocumentCommands.refundId,
            amountMinor: taxDocumentCommands.amountMinor,
            taxMinor: taxDocumentCommands.taxMinor,
            snapshot: taxDocumentCommands.allocationSnapshot,
            status: taxDocumentCommands.status,
        }).from(taxDocumentCommands).where(and(
            eq(taxDocumentCommands.orderId, row.orderId), eq(taxDocumentCommands.operation, "refund"),
            or(isNotNull(taxDocumentCommands.allocationSnapshot), eq(taxDocumentCommands.status, "dead")),
        )).orderBy(asc(taxDocumentCommands.createdAt), asc(taxDocumentCommands.id)),
    ]);
    if (priorRows.some((previous) => previous.snapshot === null && previous.status === "dead")) {
        throw new ProviderError("declined", "A previous refund tax allocation could not be established.", { code: "tax.allocation_dependency_failed" });
    }
    const sale = saleRows[0];
    if (!sale) throw new RangeError("Missing refund sale snapshot.");
    const buckets: RefundTaxBucket[] = items.map((item) => ({
        key: item.key, quantity: item.quantity, taxMinor: item.taxMinor,
        amountMinor: item.subtotalMinor - item.discountMinor + (sale.pricesIncludeTax ? 0 : item.taxMinor),
    }));
    // Shipping (or an old order without line snapshots) is the difference
    // from the original order. Never infer shipping tax from today's settings.
    const remainingAmount = sale.totalMinor - buckets.reduce((sum, bucket) => sum + bucket.amountMinor, 0);
    const remainingTax = sale.taxMinor - buckets.reduce((sum, bucket) => sum + bucket.taxMinor, 0);
    if (remainingAmount < 0 || remainingTax < 0 || remainingTax > remainingAmount) {
        throw new RangeError("Refund sale totals do not reconcile.");
    }
    if (remainingAmount > 0) buckets.push({ key: "shipping", quantity: 1, amountMinor: remainingAmount, taxMinor: remainingTax });
    const groups = new Map(payments.map((payment) => [payment.id, refundGroupId(payment.metadata)]));
    const currentGroup = groups.get(row.refundId!) ?? null;
    const prior: RefundTaxAllocation[] = [];
    const parsed = priorRows.map((previous) => ({ previous, allocation: readRefundTaxAllocation(previous.snapshot!) }));
    // Historical provider calls cannot be changed. Reconstruct their money
    // consumption, but retain exactly the tax already reversed. Distribute
    // that legacy tax over original taxable capacity; new exempt lines still
    // reverse zero. Historical discrepancies on fully consumed taxable lines
    // require reconciliation at the provider, never a tax on an exempt return.
    for (const { previous, allocation } of parsed) {
        if (allocation.version !== 0) continue;
        const groupId = groups.get(previous.refundId!) ?? null;
        const reconstructed = allocateRefundTax({
            amountMinor: previous.amountMinor!, groupId, buckets, prior,
            lines: groupId === null ? [] : lines.filter((line) => line.refundId === groupId),
        });
        const taxWeights = buckets.map((bucket) => ({
            key: bucket.key,
            weightMinor: bucket.taxMinor - prior.reduce((sum, entry) => sum + (entry.parts.find((part) => part.key === bucket.key)?.taxMinor ?? 0), 0),
        }));
        const tax = allocateMinorAmount(previous.taxMinor!, taxWeights);
        if ([...tax.values()].reduce((sum, value) => sum + value, 0) !== previous.taxMinor) throw new RangeError("Legacy refunds exceed the original tax.");
        reconstructed.parts = buckets.flatMap((bucket) => {
            const money = reconstructed.parts.find((part) => part.key === bucket.key)?.amountMinor ?? 0;
            const reversed = tax.get(bucket.key) ?? 0;
            return money > 0 || reversed > 0 ? [{ key: bucket.key, amountMinor: money, taxMinor: reversed }] : [];
        });
        prior.push(reconstructed);
    }
    for (const { allocation } of parsed) if (allocation.version === 1) prior.push(allocation);
    const allocation = allocateRefundTax({
        amountMinor: row.amountMinor!, groupId: currentGroup, buckets, prior,
        lines: currentGroup === null ? [] : lines.filter((line) => line.refundId === currentGroup),
    });
    const taxMinor = allocation.parts.reduce((sum, part) => sum + part.taxMinor, 0);
    const allocationSnapshot = JSON.stringify(allocation);
    const updated = await db.update(taxDocumentCommands).set({ taxMinor, allocationSnapshot, updatedAt: sql`unixepoch()` }).where(and(
        eq(taxDocumentCommands.id, row.id), eq(taxDocumentCommands.claimId, row.claimId!),
        eq(taxDocumentCommands.status, "processing"), isNull(taxDocumentCommands.allocationSnapshot),
        sql`${taxDocumentCommands.claimExpiresAt} > unixepoch()`,
    )).returning({ id: taxDocumentCommands.id });
    if (updated.length === 0) return false;
    row.taxMinor = taxMinor;
    row.allocationSnapshot = allocationSnapshot;
    return true;
}
