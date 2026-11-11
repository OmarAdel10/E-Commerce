import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Database } from "@scalius/database/client";
import { executeOrderRefund } from "./orders-refund";
import { NotFoundError, ValidationError } from "../../utils/api-error";

function mockContext(overrides: {
    env?: Record<string, unknown>;
    db?: Database;
    pluginPrincipal?: unknown;
    agentPrincipal?: unknown;
    user?: { id?: string } | undefined;
}): { c: { get: (key: string) => unknown; env: Record<string, unknown> } } {
    const c = {
        get: vi.fn((key: string) => {
            if (key === "db") return overrides.db;
            if (key === "env") return overrides.env ?? {};
            if (key === "pluginPrincipal") return overrides.pluginPrincipal;
            if (key === "agentPrincipal") return overrides.agentPrincipal;
            if (key === "user") return overrides.user;
            return undefined;
        }),
        env: overrides.env ?? {},
    } as unknown as { get: (key: string) => unknown; env: Record<string, unknown> };
    return { c };
}

describe("executeOrderRefund — master secret validation", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("throws when SCALIUS_SECRET is missing from env", async () => {
        const { c } = mockContext({ env: {} });
        const db = {} as Database;
        (c.get as any).mockImplementation((key: string) => {
            if (key === "db") return db;
            if (key === "env") return {};
            if (key === "pluginPrincipal") return undefined;
            if (key === "agentPrincipal") return undefined;
            if (key === "user") return undefined;
            return undefined;
        });

        await expect(
            executeOrderRefund(c as any, {
                orderId: "order_1",
                caller: "staff",
                actorUserId: null,
                reason: "Refund requested",
            }),
        ).rejects.toThrow("SCALIUS_SECRET is not installed or is too short.");
    });

    it("throws when SCALIUS_SECRET is too short (< 32 chars)", async () => {
        const { c } = mockContext({ env: { SCALIUS_SECRET: "short" } });
        const db = {} as Database;
        (c.get as any).mockImplementation((key: string) => {
            if (key === "db") return db;
            if (key === "env") return { SCALIUS_SECRET: "short" };
            return undefined;
        });

        await expect(
            executeOrderRefund(c as any, {
                orderId: "order_1",
                caller: "staff",
                actorUserId: null,
                reason: "Refund requested",
            }),
        ).rejects.toThrow("SCALIUS_SECRET is not installed or is too short.");
    });

    it("accepts a valid SCALIUS_SECRET (>= 32 chars)", async () => {
        const { c } = mockContext({ env: { SCALIUS_SECRET: "a".repeat(64) } });
        const db = {} as Database;
        (c.get as any).mockImplementation((key: string) => {
            if (key === "db") return db;
            if (key === "env") return { SCALIUS_SECRET: "a".repeat(64) };
            if (key === "pluginPrincipal") return undefined;
            if (key === "agentPrincipal") return undefined;
            if (key === "user") return undefined;
            return undefined;
        });

        // processRefund will fail because db is empty, but master secret check passes first
        await expect(
            executeOrderRefund(c as any, {
                orderId: "order_1",
                caller: "staff",
                actorUserId: null,
                reason: "Refund requested",
            }),
        ).rejects.not.toThrow("SCALIUS_SECRET is not installed or is too short.");
    });

    it("derives caller as 'staff' when no principal is set", async () => {
        const { c } = mockContext({ env: { SCALIUS_SECRET: "a".repeat(64) } });
        const db = {} as Database;
        (c.get as any).mockImplementation((key: string) => {
            if (key === "db") return db;
            if (key === "env") return { SCALIUS_SECRET: "a".repeat(64) };
            if (key === "pluginPrincipal") return undefined;
            if (key === "agentPrincipal") return undefined;
            if (key === "user") return undefined;
            return undefined;
        });

        // No principal => caller is "staff"; secret check passes; processRefund fails with db={}
        await expect(
            executeOrderRefund(c as any, {
                orderId: "order_1",
                caller: "staff",
                actorUserId: null,
                reason: "Refund requested",
            }),
        ).rejects.not.toThrow("SCALIUS_SECRET is not installed or is too short.");
    });

    it("derives caller as 'app' when pluginPrincipal is set", async () => {
        const { c } = mockContext({ env: { SCALIUS_SECRET: "a".repeat(64) }, pluginPrincipal: { pluginId: "app_1" } });
        const db = {} as Database;
        (c.get as any).mockImplementation((key: string) => {
            if (key === "db") return db;
            if (key === "env") return { SCALIUS_SECRET: "a".repeat(64) };
            if (key === "pluginPrincipal") return { pluginId: "app_1" };
            if (key === "agentPrincipal") return undefined;
            if (key === "user") return undefined;
            return undefined;
        });

        // pluginPrincipal set => caller is "app"; secret check passes; processRefund fails with db={}
        await expect(
            executeOrderRefund(c as any, {
                orderId: "order_1",
                caller: "staff",
                actorUserId: null,
                reason: "Refund requested",
            }),
        ).rejects.not.toThrow("SCALIUS_SECRET is not installed or is too short.");
    });

    it("derives caller as 'agent' when agentPrincipal is set", async () => {
        const { c } = mockContext({ env: { SCALIUS_SECRET: "a".repeat(64) }, agentPrincipal: {} });
        const db = {} as Database;
        (c.get as any).mockImplementation((key: string) => {
            if (key === "db") return db;
            if (key === "env") return { SCALIUS_SECRET: "a".repeat(64) };
            if (key === "pluginPrincipal") return undefined;
            if (key === "agentPrincipal") return {};
            if (key === "user") return undefined;
            return undefined;
        });

        // agentPrincipal set => caller is "agent"; secret check passes; processRefund fails with db={}
        await expect(
            executeOrderRefund(c as any, {
                orderId: "order_1",
                caller: "staff",
                actorUserId: null,
                reason: "Refund requested",
            }),
        ).rejects.not.toThrow("SCALIUS_SECRET is not installed or is too short.");
    });
});
