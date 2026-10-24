import { eventOutbox } from "@scalius/database/schema";
import { sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * Capture inside the subscription INSERT / first-approval UPDATE, alongside
 * its start timestamp. Seconds cannot order events inside that second, and
 * event ids have random suffixes: remember the identities already committed.
 * The occurred_at index bounds the read to the current second (and future
 * dates, if any). Its size follows that window's traffic, not a row cap: a
 * cap would silently allow historical events beyond it through the fence.
 */
export function captureEventStartExclusions(): SQL {
  return sql`(SELECT json_group_array(${eventOutbox.id}) FROM ${eventOutbox}
    WHERE ${eventOutbox.occurredAt} >= unixepoch())`;
}

/** The same durable subscription-start test for webhook and app fan-out. */
export function eventAfterSubscriptionStart(
  event: { id: string; occurredAt: number },
  startedAt: AnySQLiteColumn,
  exclusions: AnySQLiteColumn,
): SQL {
  return sql`${startedAt} <= ${event.occurredAt} AND NOT EXISTS (
    SELECT 1 FROM json_each(${exclusions}) WHERE CAST(value AS TEXT) = ${event.id}
  )`;
}
