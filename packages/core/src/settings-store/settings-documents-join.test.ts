// packages/core/src/settings-store/settings-documents-join.test.ts
// The batch read that checkout authority uses: one document asked for, several
// documents asked for, and the persisted checkout document read back through it.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1Database, type SqliteTestDatabase } from "@scalius/database/testing/sqlite-d1";
import { selectSettingsDocuments } from "./index";
import { checkoutDocument } from "../modules/settings";

describe("selectSettingsDocuments — settingsDocumentsJoin", () => {
  let fixture: SqliteTestDatabase;

  beforeEach(() => { fixture = createSqliteD1Database(); });
  afterEach(() => fixture.sqlite.close());

  const seedDocument = (category: string, value: Record<string, unknown>) => {
    fixture.sqlite.prepare(`
      INSERT INTO settings (id, category, key, value, type, revision)
      VALUES (?, ?, 'document', ?, 'json', 1)
    `).run(`seeded-${category}`, category, JSON.stringify(value));
  };

  it("reads only the asked document when one is asked for", async () => {
    seedDocument("checkout", { checkoutMode: "all" });
    seedDocument("currency", { currencyCode: "BDT" });
    const rows = await selectSettingsDocuments(fixture.db, [{ key: "checkout" }]);
    expect(rows.map((row) => row.category)).toEqual(["checkout"]);
  });

  it("reads every asked document when several are asked for", async () => {
    seedDocument("checkout", { checkoutMode: "all" });
    seedDocument("currency", { currencyCode: "BDT" });
    seedDocument("site", { guestCheckoutEnabled: true });
    const rows = await selectSettingsDocuments(fixture.db, [{ key: "checkout" }, { key: "currency" }]);
    expect(rows.map((row) => row.category).sort()).toEqual(["checkout", "currency"]);
  });

  it("returns the persisted default product policy through the batch read", async () => {
    await checkoutDocument.write(fixture.db, { codDepositDefaultProductPolicy: "selected" });
    const rows = await selectSettingsDocuments(fixture.db, [{ key: "checkout" }]);
    const read = await checkoutDocument.fromRows(rows);
    expect(read.stored).toBe(true);
    expect(read.value.codDepositDefaultProductPolicy).toBe("selected");
  });

  it("reads no row when no document is asked for", async () => {
    seedDocument("checkout", { checkoutMode: "all" });
    const rows = await selectSettingsDocuments(fixture.db, []);
    expect(rows).toEqual([]);
  });
});
