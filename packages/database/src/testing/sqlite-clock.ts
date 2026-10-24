import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

/**
 * One connection-local clock for SQL predicates, timestamp defaults and event
 * ids. A separate SQLite connection evaluates native formats and modifiers;
 * only the implicit/explicit "now" argument changes. The evaluator closes with
 * the owning database, including fixtures and temporary DVC copies.
 */
export function createSqliteClock(sqlite: DatabaseSync, milliseconds: number | (() => number)) {
  let read = typeof milliseconds === "function" ? milliseconds : () => milliseconds;
  const valid = (value: number) => {
    if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) throw new Error("Invalid SQLite test time");
    return value;
  };
  valid(read());
  const evaluator = new DatabaseSync(":memory:");
  const statements = new Map<string, StatementSync>();
  const set = (value: number) => {
    valid(value);
    read = () => value;
  };
  const close = sqlite.close.bind(sqlite);
  sqlite.close = () => {
    try { close(); }
    finally { evaluator.close(); }
  };
  for (const name of ["unixepoch", "strftime", "julianday", "date", "time", "datetime"]) {
    sqlite.function(name, { varargs: true }, (...input) => {
      const args: SQLInputValue[] = [...input];
      const index = name === "strftime" ? 1 : 0;
      const value = args[index];
      const timestamp = new Date(valid(read())).toISOString();
      if (args.length === index) args.push(timestamp);
      else if (typeof value === "string" && value.toLowerCase() === "now") args[index] = timestamp;
      else if (value === "subsec" || value === "subsecond") args.splice(index, 0, timestamp);
      const key = `${name}:${args.length}`;
      let statement = statements.get(key);
      if (!statement) {
        statement = evaluator.prepare(`SELECT ${name}(${args.map(() => "?").join(",")}) AS value`);
        statements.set(key, statement);
      }
      return statement.get(...args)!.value as SQLInputValue;
    });
  }
  return {
    get milliseconds() { return valid(read()); },
    get seconds() { return Math.floor(valid(read()) / 1_000); },
    set,
    advance(milliseconds: number) { set(valid(read()) + milliseconds); },
  };
}

export type SqliteClock = ReturnType<typeof createSqliteClock>;
