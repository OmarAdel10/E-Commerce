import { getTableName, sql, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * Keeps an outer column qualified inside a scalar SELECT expression. Drizzle
 * strips Column qualification in single-table selections; a nested query's
 * same-named column would otherwise capture the reference. Identifier nodes
 * retain the scope and quote names safely, including aliased tables.
 */
export function qualifiedColumn(column: AnyColumn): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}
