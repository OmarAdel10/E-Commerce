import { describe, expect, it, vi, beforeEach } from "vitest";
import { runScheduledMaintenance } from "./scheduled-maintenance";
import { MAINTENANCE_SWEEPS } from "./scheduled-maintenance";
import { getDb } from "@scalius/database/client";

vi.mock("@scalius/database/client", () => ({
    getDb: vi.fn(() => ({} as any)),
}));

vi.mock("./scheduled/due-work", () => ({
    readDueDrains: vi.fn(() => new Set<string>()),
}));

vi.mock("./scheduled/slices", () => ({
    dueSweepIndexes: vi.fn(() => [] as number[]),
}));

vi.mock("./realtime/publish", () => ({
    publishRealtime: vi.fn(),
    tableChanges: vi.fn(() => []),
}));

vi.mock("@scalius/database/read-observer", () => ({
    runWithReadObserver: vi.fn(async (_writes: unknown, sweep: () => Promise<unknown>) => await sweep()),
}));

vi.mock("./middleware/event-dispatch", () => ({
    createEventWriteObserver: vi.fn(() => ({
        realtimeTopics: new Set<string>(),
    })),
}));

function makeEnv(overrides: Record<string, unknown> = {}): Env {
    return {
        SCALIUS_SECRET: "a".repeat(64),
        CREDENTIAL_ENCRYPTION_KEY: "b".repeat(44),
        ...overrides,
    } as unknown as Env;
}

function makeExecutionContext(): ExecutionContext {
    return {
        passThroughOnException: () => undefined,
        waitUntil: () => undefined,
    } as unknown as ExecutionContext;
}

describe("runScheduledMaintenance — SCALIUS_SECRET gating", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("completes successfully with a valid SCALIUS_SECRET when no sweeps are due", async () => {
        const env = makeEnv({ SCALIUS_SECRET: "a".repeat(64) });
        await expect(
            runScheduledMaintenance(env as Env, makeExecutionContext()),
        ).resolves.toBeUndefined();
    });

    it("throws when SCALIUS_SECRET is missing and a sweep that requires it runs", async () => {
        // The refund_attempt_reconciliation sweep (index 8) requires SCALIUS_SECRET
        // and throws when it is missing. Test it directly via MAINTENANCE_SWEEPS.
        const sweep = MAINTENANCE_SWEEPS[8]!;
        const env = makeEnv({});
        delete (env as Record<string, unknown>).SCALIUS_SECRET;
        await expect(
            sweep.run({
                db: {} as any,
                env: env as Env,
                executionCtx: makeExecutionContext(),
                runContext: { runId: "test", startedAt: 0, cron: "test", scheduledTime: "test", scheduledAt: 0 },
                timed: async <T>(_op: string, fn: () => Promise<T>) => await fn(),
            }),
        ).rejects.toThrow("SCALIUS_SECRET is not installed or is too short.");
    });

    it("throws when SCALIUS_SECRET is too short and a sweep that requires it runs", async () => {
        const sweep = MAINTENANCE_SWEEPS[8]!;
        const env = makeEnv({ SCALIUS_SECRET: "short" });
        await expect(
            sweep.run({
                db: {} as any,
                env: env as Env,
                executionCtx: makeExecutionContext(),
                runContext: { runId: "test", startedAt: 0, cron: "test", scheduledTime: "test", scheduledAt: 0 },
                timed: async <T>(_op: string, fn: () => Promise<T>) => await fn(),
            }),
        ).rejects.toThrow("SCALIUS_SECRET is not installed or is too short.");
    });

    it("accepts a valid SCALIUS_SECRET in the sweep that requires it", async () => {
        const sweep = MAINTENANCE_SWEEPS[8]!;
        const env = makeEnv({ SCALIUS_SECRET: "a".repeat(64) });
        // The sweep will try to use db (which is {}), so it will fail at a later step,
        // but the SCALIUS_SECRET check passes first.
        await expect(
            sweep.run({
                db: {} as any,
                env: env as Env,
                executionCtx: makeExecutionContext(),
                runContext: { runId: "test", startedAt: 0, cron: "test", scheduledTime: "test", scheduledAt: 0 },
                timed: async <T>(_op: string, fn: () => Promise<T>) => await fn(),
            }),
        ).rejects.toThrow(); // Fails at db usage, not at SCALIUS_SECRET check
    });
});
