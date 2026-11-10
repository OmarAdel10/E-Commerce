import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Database } from "@scalius/database/client";
import { sql } from "drizzle-orm";
import { ShipmentStatus, OrderStatus, PaymentMethod } from "@scalius/database/schema";
import { PROVIDER_OUTCOME_UNKNOWN } from "../delivery";
import { ValidationError, ConflictError } from "@scalius/core/errors";
import { assertManualCodDepositVerified } from "../payments";
import {
    reconcileOrderShipment,
    resolveUnknownOrderShipment,
} from "./reconcile";

// --- Mock external dependencies so reconcileOrderShipment can run with a stub DB ---

vi.mock("../order-kernel", () => ({
    assertNoActiveRefundAttempt: vi.fn().mockResolvedValue(undefined),
    assertNoActivePaymentSessionAttempt: vi.fn().mockResolvedValue(undefined),
    validateTransition: vi.fn().mockImplementation(() => {}),
    noActiveRefundAttemptForOrderIdCondition: vi.fn(() => sql`1 = 1`),
    noActivePaymentSessionAttemptForOrderIdCondition: vi.fn(() => sql`1 = 1`),
}));

vi.mock("../payments", () => ({
    assertManualCodDepositVerified: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../orders", () => ({
    reconcileInventoryForStatus: vi.fn().mockResolvedValue([]),
}));

vi.mock("./ledger", () => ({
    recordCourierBookingFulfilment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./shared", () => ({
    parseShipmentMetadata: (metadata: unknown) => {
        if (!metadata) return {};
        if (typeof metadata === "string") {
            try {
                const parsed = JSON.parse(metadata) as unknown;
                return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                    ? (parsed as Record<string, unknown>)
                    : {};
            } catch {
                return {};
            }
        }
        return metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? (metadata as Record<string, unknown>)
            : {};
    },
    clearShipmentClaim: vi.fn().mockResolvedValue(undefined),
}));

// --- Fixtures ---

const orderId = "order_1";
const shipmentId = "shipment_1";

const baseShipment: Record<string, unknown> = {
    id: shipmentId,
    orderId,
    status: ShipmentStatus.RECONCILE_REQUIRED,
    rawStatus: "confirmed_existing_shipment",
    externalId: "ext_1",
    trackingId: "track_1",
    metadata: JSON.stringify({}),
};

const baseOrder: Record<string, unknown> = {
    id: orderId,
    status: OrderStatus.PENDING,
    version: 1,
    fulfillmentStatus: null,
    shipmentClaimId: shipmentId,
    paymentMethod: PaymentMethod.COD,
};

function mockDb(overrides: {
    shipment?: Record<string, unknown>;
    order?: Record<string, unknown>;
    orderFirst?: boolean;
} = {}) {
    const first = overrides.orderFirst ? (overrides.order ?? baseOrder) : (overrides.shipment ?? baseShipment);
    const second = overrides.orderFirst ? (overrides.shipment ?? baseShipment) : (overrides.order ?? baseOrder);
    const getMock = vi.fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);

    const updateMock = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: orderId }]),
            }),
        }),
    });

    const db = {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    get: getMock,
                }),
            }),
        }) as any,
        update: updateMock as any,
        batch: vi.fn().mockResolvedValue([[]]) as any,
    } as unknown as Database;

    return { db, updateMock };
}

function shipmentMetadataSetCalls(updateMock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
    return updateMock.mock.results
        .map((result) => {
            const setMock = (result.value as { set?: ReturnType<typeof vi.fn> })?.set;
            if (!setMock) return [];
            return setMock.mock.calls.map((call) => call[0]);
        })
        .flat()
        .filter((arg): arg is Record<string, unknown> => arg != null && typeof arg === "object" && "metadata" in arg);
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertManualCodDepositVerified).mockResolvedValue(undefined);
});

describe("reconcile module — cleanShipmentRecoveryMetadata", () => {
    it("strips reconciliation and orderStatusSync from shipment metadata, keeps other keys", async () => {
        const metadata = {
            reconciliation: { required: true, reason: "provider_unknown" },
            orderStatusSync: { shipmentStatus: "shipped", orderStatus: "shipped" },
            carrier: "courier_x",
            externalReference: "ref_123",
        };
        const { db, updateMock } = mockDb({
            shipment: {
                ...baseShipment,
                rawStatus: "confirmed_existing_shipment",
                metadata: JSON.stringify(metadata),
            },
            order: {
                ...baseOrder,
                paymentMethod: PaymentMethod.NET_TERMS,
            },
        });

        await reconcileOrderShipment(db, orderId, shipmentId);

        const setCalls = shipmentMetadataSetCalls(updateMock);
        expect(setCalls.length).toBeGreaterThan(0);

        for (const written of setCalls) {
            const parsed = typeof written.metadata === "string" ? JSON.parse(written.metadata) : written.metadata;
            expect(parsed.reconciliation).toBeUndefined();
            expect(parsed.orderStatusSync).toBeUndefined();
            expect(parsed.carrier).toBe("courier_x");
            expect(parsed.externalReference).toBe("ref_123");
        }
    });
});

describe("reconcile module — safeFinalizedShipmentStatus", () => {
    it("uses the reconciliation providerStatus as the finalized shipment status", async () => {
        const { db, updateMock } = mockDb({
            shipment: {
                ...baseShipment,
                rawStatus: "delivered",
                externalId: null,
                trackingId: null,
                metadata: JSON.stringify({
                    reconciliation: { providerStatus: "delivered", reason: "provider_confirmed" },
                }),
            },
            order: {
                ...baseOrder,
                paymentMethod: PaymentMethod.NET_TERMS,
            },
        });

        const result = await reconcileOrderShipment(db, orderId, shipmentId);

        expect(result.status).toBe("repaired");
        expect(result.shipmentStatus).toBe("delivered");

        const setCalls = shipmentMetadataSetCalls(updateMock);
        expect(setCalls.length).toBeGreaterThan(0);
    });

    it("falls back to PENDING when no usable explicit provider state exists", async () => {
        const { db } = mockDb({
            shipment: {
                ...baseShipment,
                rawStatus: "creating",
                externalId: "ext_1",
                trackingId: "track_1",
                metadata: JSON.stringify({
                    reconciliation: { providerStatus: "creating", reason: "provider_confirmed" },
                }),
            },
            order: {
                ...baseOrder,
                paymentMethod: PaymentMethod.NET_TERMS,
            },
        });

        const result = await reconcileOrderShipment(db, orderId, shipmentId);

        expect(result.status).toBe("repaired");
        expect(result.shipmentStatus).toBe(ShipmentStatus.PENDING);
    });
});

describe("reconcile module — getUnknownShipmentResolutionEvidence", () => {
    it("treats already-resolved evidence with a different operation key as a conflict", async () => {
        const { db } = mockDb({
            orderFirst: true,
            order: {
                ...baseOrder,
                shipmentClaimId: null,
            },
            shipment: {
                ...baseShipment,
                rawStatus: "confirmed_existing_shipment",
                metadata: JSON.stringify({
                    reconciliation: { required: true, reason: "provider_confirmed" },
                    unknownOutcomeResolution: {
                        operationKey: "old-key",
                        method: "provider_lookup",
                        outcome: "confirmed_existing",
                        evidenceSource: "provider_api_invoice_lookup",
                        confirmedAt: "2026-01-01T00:00:00.000Z",
                    },
                }),
            },
        });

        await expect(
            resolveUnknownOrderShipment(db, {
                orderId,
                shipmentId,
                expectedOrderVersion: 1,
                outcome: "confirmed_not_created",
                evidenceSource: "courier_portal",
                evidenceNote: "resolved via courier portal lookup",
                confirmationAccepted: true,
                actorId: null,
                operationKey: "new-key",
            }),
        ).rejects.toThrow(ConflictError);
    });
});

describe("reconcile module — manual COD deposit verification", () => {
    it("blocks fulfilment advancement when the deposit guard throws for a COD order", async () => {
        vi.mocked(assertManualCodDepositVerified).mockRejectedValueOnce(
            new ValidationError("The deposit must be recorded before this order can move on."),
        );

        const { db } = mockDb({
            shipment: {
                ...baseShipment,
                rawStatus: "confirmed_existing_shipment",
                metadata: JSON.stringify({
                    orderStatusSync: { shipmentStatus: "shipped", orderStatus: "shipped" },
                }),
            },
            order: {
                ...baseOrder,
                paymentMethod: PaymentMethod.COD,
            },
        });

        await expect(reconcileOrderShipment(db, orderId, shipmentId)).rejects.toThrow(
            "The deposit must be recorded before this order can move on.",
        );
        expect(vi.mocked(assertManualCodDepositVerified)).toHaveBeenCalledWith(db, orderId);
    });

    it("allows fulfilment advancement for a non-COD order without calling the deposit guard", async () => {
        const { db } = mockDb({
            shipment: {
                ...baseShipment,
                rawStatus: "confirmed_existing_shipment",
                metadata: JSON.stringify({
                    orderStatusSync: { shipmentStatus: "shipped", orderStatus: "shipped" },
                }),
            },
            order: {
                ...baseOrder,
                paymentMethod: PaymentMethod.NET_TERMS,
            },
        });

        const result = await reconcileOrderShipment(db, orderId, shipmentId);

        expect(result.status).toBe("repaired");
        expect(vi.mocked(assertManualCodDepositVerified)).not.toHaveBeenCalled();
    });
});
