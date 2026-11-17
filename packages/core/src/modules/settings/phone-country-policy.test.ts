import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1Database } from "@scalius/database/testing/sqlite-d1";
import { sql } from "drizzle-orm";
import { settings } from "@scalius/database/schema";
import { selectDocumentsWithSellingCountries } from "./phone-country-policy";

describe("selectDocumentsWithSellingCountries — backupPriceIncrementMinor", () => {
  let fixture: ReturnType<typeof createSqliteD1Database>;
  beforeEach(() => {
    fixture = createSqliteD1Database();
  });
  afterEach(() => fixture.sqlite.close());

  const insertSettings = (category: string, value: unknown, revision: number = 1) => {
    fixture.sqlite.exec(`
      INSERT INTO settings (id, key, value, type, category, revision)
      VALUES ('settings_${category}', 'test_key_${category}', '${JSON.stringify(value)}', 'json', '${category}', ${revision});
    `);
  };

  it("returns backupPriceIncrementMinor undefined when priceIncrement not provided", async () => {
    insertSettings("checkout", { enabled: true });
    const result = await selectDocumentsWithSellingCountries(fixture.db, [{ key: "test_key_checkout" }]);
    expect(result.backupPriceIncrementMinor).toBeUndefined();
  });

  it("returns backupPriceIncrementMinor from provided priceIncrement SQL", async () => {
    insertSettings("checkout", { enabled: true });
    const result = await selectDocumentsWithSellingCountries(
      fixture.db,
      [{ key: "test_key_checkout" }],
      sql`100`,
    );
    expect(result.backupPriceIncrementMinor).toBe(100);
  });
});
