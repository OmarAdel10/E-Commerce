import { describe, expect, it } from "vitest";
import {
    CURRENT_DATABASE_SCHEMA,
    CURRENT_DATABASE_SCHEMA_MIGRATIONS,
    assertDatabaseSchemaCompatible,
    DATABASE_SCHEMA_LEGACY_BASELINE,
} from "./schema-contract";

describe("CURRENT_DATABASE_SCHEMA — version contract", () => {
    it("is at version 190 (0190_striped_puppet_master)", () => {
        expect(CURRENT_DATABASE_SCHEMA.version).toBe(190);
        expect(CURRENT_DATABASE_SCHEMA.name).toBe("0190_striped_puppet_master");
    });
});

describe("CURRENT_DATABASE_SCHEMA_MIGRATIONS — migration 190 entry", () => {
    it("includes migration 190 with the expected source sha256", () => {
        const migration190 = CURRENT_DATABASE_SCHEMA_MIGRATIONS.find((m) => m.version === 190);
        expect(migration190).toBeDefined();
        expect(migration190!.name).toBe("0190_striped_puppet_master");
        expect(migration190!.sourceSha256).toBe(
            "59ee55d643e98a3bc7d0e0dd4a46f75bb354123319eb90ce30b87043e97f83e5",
        );
    });

    it("has 141 migrations (versions 50 through 190)", () => {
        expect(CURRENT_DATABASE_SCHEMA_MIGRATIONS.length).toBe(141);
    });

    it("versions are sequential from 50 to 190", () => {
        for (let i = 0; i < CURRENT_DATABASE_SCHEMA_MIGRATIONS.length; i += 1) {
            expect(CURRENT_DATABASE_SCHEMA_MIGRATIONS[i]!.version).toBe(50 + i);
        }
    });

    it("every migration has a valid 64-char hex sourceSha256", () => {
        for (const migration of CURRENT_DATABASE_SCHEMA_MIGRATIONS) {
            expect(/^[a-f0-9]{64}$/.test(migration.sourceSha256)).toBe(true);
        }
    });
});

describe("assertDatabaseSchemaCompatible — validation", () => {
    const validRows = CURRENT_DATABASE_SCHEMA_MIGRATIONS.map((m) => ({
        version: m.version,
        name: m.name,
        sourceSha256: m.sourceSha256,
    }));

    it("accepts a complete valid migration ledger", () => {
        const result = assertDatabaseSchemaCompatible(validRows);
        expect(result.version).toBe(190);
        expect(result.name).toBe("0190_striped_puppet_master");
    });

    it("rejects missing ledger", () => {
        expect(() => assertDatabaseSchemaCompatible(undefined)).toThrow(
            "Database schema migration authority is missing.",
        );
        expect(() => assertDatabaseSchemaCompatible([])).toThrow(
            "Database schema migration authority is missing.",
        );
    });

    it("rejects wrong row count", () => {
        expect(() => assertDatabaseSchemaCompatible(validRows.slice(0, -1))).toThrow(
            "Database schema migration ledger has 140 row(s); expected 141.",
        );
    });

    it("rejects a divergent sourceSha256 at version 190", () => {
        const tampered: Array<{ version: number; name: string; sourceSha256: string }> = [...validRows];
        tampered[tampered.length - 1] = {
            ...tampered[tampered.length - 1]!,
            sourceSha256: "0".repeat(64),
        };
        expect(() => assertDatabaseSchemaCompatible(tampered)).toThrow(
            "Database schema migration ledger diverges at version 190.",
        );
    });

    it("rejects a divergent name at version 190", () => {
        const tampered: Array<{ version: number; name: string; sourceSha256: string }> = [...validRows];
        tampered[tampered.length - 1] = {
            ...tampered[tampered.length - 1]!,
            name: "0190_tampered_name",
        };
        expect(() => assertDatabaseSchemaCompatible(tampered)).toThrow(
            "Database schema migration ledger diverges at version 190.",
        );
    });

    it("rejects a non-hex sourceSha256", () => {
        const tampered: Array<{ version: number; name: string; sourceSha256: string }> = [...validRows];
        tampered[tampered.length - 1] = {
            ...tampered[tampered.length - 1]!,
            sourceSha256: "not-a-valid-hash",
        };
        expect(() => assertDatabaseSchemaCompatible(tampered)).toThrow(
            "Database schema migration authority is invalid.",
        );
    });
});

describe("DATABASE_SCHEMA_LEGACY_BASELINE — legacy baseline", () => {
    it("has version 49 with valid sha256 hashes", () => {
        expect(DATABASE_SCHEMA_LEGACY_BASELINE.version).toBe(49);
        expect(DATABASE_SCHEMA_LEGACY_BASELINE.name).toBe("0049_checkout_side_effect_authority_fence");
        expect(/^[a-f0-9]{64}$/.test(DATABASE_SCHEMA_LEGACY_BASELINE.tursoSchemaSha256)).toBe(true);
        expect(/^[a-f0-9]{64}$/.test(DATABASE_SCHEMA_LEGACY_BASELINE.postgresSchemaSha256)).toBe(true);
    });
});
