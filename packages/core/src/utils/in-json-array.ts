import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * A list membership predicate with one bound parameter on every provider.
 * Callers still bound the amount of work; encoding a list does not paginate it.
 */
export function inJsonArray(column: SQLWrapper, values: readonly (string | number)[]): SQL {
  return sql`${column} in (select value from json_each(${JSON.stringify(values)}))`;
}
