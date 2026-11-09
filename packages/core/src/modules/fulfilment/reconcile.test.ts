import { describe, expect, it } from "vitest";
import {
    cleanShipmentRecoveryMetadata,
    getUnknownShipmentResolutionEvidence,
    safeFinalizedShipmentStatus,
} from "./reconcile";
import { ShipmentStatus } from "@scalius/database/schema";

describe("safeFinalizedShipmentStatus — provider state inference", () => {
    it("returns explicit providerStatus from reconciliation metadata", () => {
        const shipment = { rawStatus: null };
        const metadata = { reconciliation: { providerStatus: "delivered" } };
        const result = safeFinalizedShipmentStatus(shipment, metadata);
        expect(result.status).toBe("delivered");
        expect(result.hasExplicitProviderState).toBe(true);
    });

    it("falls back to metadata order_status", () => {
        const shipment = { rawStatus: null };
        const metadata = { order_status: "shipped" };
        const result = safeFinalizedShipmentStatus(shipment, metadata);
        expect(result.status).toBe("shipped");
        expect(result.hasExplicitProviderState).toBe(true);
    });

    it("falls back to metadata status", () => {
        const shipment = { rawStatus: null };
        const metadata = { status: "delivered" };
        const result = safeFinalizedShipmentStatus(shipment, metadata);
        expect(result.status).toBe("delivered");
        expect(result.hasExplicitProviderState).toBe(true);
    });

    it("returns rawStatus when it is a clean non-reconcile status", () => {
        const shipment = { rawStatus: "delivered" };
        const metadata = {};
        const result = safeFinalizedShipmentStatus(shipment, metadata);
        expect(result.status).toBe("delivered");
        expect(result.hasExplicitProviderState).toBe(true);
    });

    it("returns PENDING when rawStatus is PROVIDER_OUTCOME_UNKNOWN", () => {
        const shipment = { rawStatus: "provider_outcome_unknown" };
        const metadata = {};
        const result = safeFinalizedShipmentStatus(shipment, metadata);
        expect(result.status).toBe(ShipmentStatus.PENDING);
        expect(result.hasExplicitProviderState).toBe(false);
    });

    it("returns PENDING when rawStatus is RECONCILE_REQUIRED", () => {
        const shipment = { rawStatus: ShipmentStatus.RECONCILE_REQUIRED };
        const metadata = {};
        const result = safeFinalizedShipmentStatus(shipment, metadata);
        expect(result.status).toBe(ShipmentStatus.PENDING);
        expect(result.hasExplicitProviderState).toBe(false);
    });

    it("returns PENDING when rawStatus ends with _failed", () => {
        const shipment = { rawStatus: "provider_failed" };
        const metadata = {};
        const result = safeFinalizedShipmentStatus(shipment, metadata);
        expect(result.status).toBe(ShipmentStatus.PENDING);
        expect(result.hasExplicitProviderState).toBe(false);
    });

    it("returns PENDING when rawStatus contains reconcile", () => {
        const shipment = { rawStatus: "reconcile_pending" };
        const metadata = {};
        const result = safeFinalizedShipmentStatus(shipment, metadata);
        expect(result.status).toBe(ShipmentStatus.PENDING);
        expect(result.hasExplicitProviderState).toBe(false);
    });

    it("returns PENDING when rawStatus contains claim", () => {
        const shipment = { rawStatus: "claim_locked" };
        const metadata = {};
        const result = safeFinalizedShipmentStatus(shipment, metadata);
        expect(result.status).toBe(ShipmentStatus.PENDING);
        expect(result.hasExplicitProviderState).toBe(false);
    });

    it("returns PENDING for empty rawStatus with no metadata", () => {
        const shipment = { rawStatus: null };
        const metadata = {};
        const result = safeFinalizedShipmentStatus(shipment, metadata);
        expect(result.status).toBe(ShipmentStatus.PENDING);
        expect(result.hasExplicitProviderState).toBe(false);
    });
});

describe("cleanShipmentRecoveryMetadata — reconciliation stripping", () => {
    it("removes reconciliation and orderStatusSync keys", () => {
        const metadata = {
            reconciliation: { reason: "provider_outcome_unknown" },
            orderStatusSync: { shipmentStatus: "shipped" },
            other: "kept",
        };
        const result = cleanShipmentRecoveryMetadata(metadata);
        expect(result).toBe(JSON.stringify({ other: "kept" }));
    });

    it("returns null when no keys remain after stripping", () => {
        const metadata = {
            reconciliation: { reason: "provider_outcome_unknown" },
        };
        const result = cleanShipmentRecoveryMetadata(metadata);
        expect(result).toBeNull();
    });

    it("preserves unknownOutcomeResolution", () => {
        const metadata = {
            unknownOutcomeResolution: { operationKey: "key_1", outcome: "confirmed_existing" },
        };
        const result = cleanShipmentRecoveryMetadata(metadata);
        expect(JSON.parse(result!)).toHaveProperty("unknownOutcomeResolution");
    });
});

describe("getUnknownShipmentResolutionEvidence — evidence parsing", () => {
    it("returns null when unknownOutcomeResolution is missing", () => {
        const metadata = {};
        const result = getUnknownShipmentResolutionEvidence(metadata);
        expect(result).toBeNull();
    });

    it("returns null when operationKey is missing", () => {
        const metadata = { unknownOutcomeResolution: { outcome: "confirmed_existing" } };
        const result = getUnknownShipmentResolutionEvidence(metadata);
        expect(result).toBeNull();
    });

    it("returns null when confirmedAt is missing", () => {
        const metadata = { unknownOutcomeResolution: { operationKey: "key_1" } };
        const result = getUnknownShipmentResolutionEvidence(metadata);
        expect(result).toBeNull();
    });

    it("returns null when method is invalid", () => {
        const metadata = {
            unknownOutcomeResolution: {
                operationKey: "key_1",
                method: "invalid_method",
                outcome: "confirmed_existing",
                evidenceSource: "provider_api_invoice_lookup",
                confirmedAt: "2024-01-01T00:00:00Z",
            },
        };
        const result = getUnknownShipmentResolutionEvidence(metadata);
        expect(result).toBeNull();
    });

    it("returns null when outcome is invalid", () => {
        const metadata = {
            unknownOutcomeResolution: {
                operationKey: "key_1",
                method: "provider_lookup",
                outcome: "invalid_outcome",
                evidenceSource: "provider_api_invoice_lookup",
                confirmedAt: "2024-01-01T00:00:00Z",
            },
        };
        const result = getUnknownShipmentResolutionEvidence(metadata);
        expect(result).toBeNull();
    });

    it("returns null when evidenceSource is invalid", () => {
        const metadata = {
            unknownOutcomeResolution: {
                operationKey: "key_1",
                method: "provider_lookup",
                outcome: "confirmed_existing",
                evidenceSource: "invalid_source",
                confirmedAt: "2024-01-01T00:00:00Z",
            },
        };
        const result = getUnknownShipmentResolutionEvidence(metadata);
        expect(result).toBeNull();
    });

    it("parses valid evidence fully", () => {
        const metadata = {
            unknownOutcomeResolution: {
                operationKey: "key_1",
                method: "merchant_attestation",
                outcome: "confirmed_cancelled",
                evidenceSource: "courier_support",
                evidenceNote: "Courier confirmed cancellation",
                actorId: "staff_1",
                confirmedAt: "2024-01-01T00:00:00Z",
            },
        };
        const result = getUnknownShipmentResolutionEvidence(metadata);
        expect(result).toBeDefined();
        expect(result!.operationKey).toBe("key_1");
        expect(result!.method).toBe("merchant_attestation");
        expect(result!.outcome).toBe("confirmed_cancelled");
        expect(result!.evidenceSource).toBe("courier_support");
        expect(result!.evidenceNote).toBe("Courier confirmed cancellation");
        expect(result!.actorId).toBe("staff_1");
        expect(result!.confirmedAt).toBe("2024-01-01T00:00:00Z");
    });

    it("accepts provider_lookup method", () => {
        const metadata = {
            unknownOutcomeResolution: {
                operationKey: "key_1",
                method: "provider_lookup",
                outcome: "confirmed_existing",
                evidenceSource: "provider_api_invoice_lookup",
                confirmedAt: "2024-01-01T00:00:00Z",
            },
        };
        const result = getUnknownShipmentResolutionEvidence(metadata);
        expect(result).toBeDefined();
        expect(result!.method).toBe("provider_lookup");
    });

    it("treats missing optional fields as undefined/null", () => {
        const metadata = {
            unknownOutcomeResolution: {
                operationKey: "key_1",
                method: "provider_lookup",
                outcome: "confirmed_existing",
                evidenceSource: "provider_api_invoice_lookup",
                confirmedAt: "2024-01-01T00:00:00Z",
            },
        };
        const result = getUnknownShipmentResolutionEvidence(metadata);
        expect(result!.evidenceNote).toBeUndefined();
        expect(result!.actorId).toBeNull();
    });
});
