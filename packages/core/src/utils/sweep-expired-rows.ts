import type { Database } from "@scalius/database/client";
import { and, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn, AnySQLiteTable } from "drizzle-orm/sqlite-core";
import { inJsonArray } from "./in-json-array";

/** Bounded maintenance; a renewal between selection and deletion must survive. */
export async function sweepExpiredRows(
  db: Database,
  table: AnySQLiteTable,
  key: AnySQLiteColumn<{ data: string }>,
  expired: SQL | undefined,
  limit: number,
): Promise<{ scanned: number; deleted: number; limit: number; hasMore: boolean }> {
  if (!expired) throw new Error("An expiry sweep requires a stale-row predicate.");
  const rows = await db.select({ id: key }).from(table).where(expired).limit(limit + 1);
  const ids = rows.slice(0, limit).map((row) => row.id);
  const deleted = ids.length === 0 ? [] : await db.delete(table)
    .where(and(expired, inJsonArray(key, ids)))
    .returning({ id: key });
  return {
    scanned: ids.length,
    deleted: deleted.length,
    limit,
    hasMore: rows.length > limit,
  };
}
