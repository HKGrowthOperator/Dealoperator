import { Pool } from "pg";
import { connectionOptions } from "./config";
export type QueryResult = {
  rows: Record<string, any>[];
  rowCount?: number | null;
  affectedRows?: number;
};
export interface Executor {
  query(sql: string, params?: any[]): Promise<QueryResult>;
}
export class Database {
  constructor(
    readonly executor: Executor,
    private readonly transactionFactory?: <T>(
      fn: (db: Database) => Promise<T>,
    ) => Promise<T>,
  ) {}
  async query<T extends Record<string, any> = Record<string, any>>(
    sql: string,
    params: any[] = [],
  ): Promise<T[]> {
    return (await this.executor.query(sql, params)).rows as T[];
  }
  prepare(sql: string) {
    return new Statement(this, sql);
  }
  async transaction<T>(fn: (db: Database) => Promise<T>): Promise<T> {
    if (!this.transactionFactory) throw Error("Transaction provider missing");
    return this.transactionFactory(fn);
  }
  async batch(statements: Statement[]) {
    return this.transaction(async (tx) =>
      Promise.all(
        statements.map((s) => new Statement(tx, s.sql, s.values).run()),
      ),
    );
  }
}
// Old community handlers retain their bound parameter interface; all SQL is PostgreSQL.
export function placeholders(sql: string) {
  let i = 0,
    quoted = false;
  return sql.replace(/''|'|\?/g, (m) => {
    if (m === "''") return m;
    if (m === "'") {
      quoted = !quoted;
      return m;
    }
    return quoted ? m : `$${++i}`;
  });
}
class Statement {
  constructor(
    readonly db: Database,
    readonly sql: string,
    readonly values: any[] = [],
  ) {}
  bind(...values: any[]) {
    return new Statement(this.db, this.sql, values);
  }
  async first<T = Record<string, any>>(): Promise<T | null> {
    return (
      ((await this.db.query(placeholders(this.sql), this.values))[0] as T) ??
      null
    );
  }
  async all() {
    return {
      results: await this.db.query(placeholders(this.sql), this.values),
    };
  }
  async run() {
    const r = await this.db.executor.query(placeholders(this.sql), this.values);
    return { meta: { changes: r.rowCount ?? r.affectedRows ?? 0 } };
  }
}
let instance: Database | undefined;
export function databaseReady() {
  return !!process.env.DATABASE_URL;
}
export function database() {
  if (!databaseReady())
    throw Error("Die Anmeldung und Speicherung werden gerade eingerichtet.");
  if (instance) return instance;
  const pool = new Pool(connectionOptions());
  instance = new Database(pool, async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(new Database(client));
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });
  return instance;
}
