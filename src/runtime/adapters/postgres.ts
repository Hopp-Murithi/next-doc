import type { BeginResult, IdempotencyAdapter, IdempotencyRecord } from "../types.js";

/** Structural shape of a node-postgres style pool or client. */
export interface PgLikeClient {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface PostgresAdapterOptions {
  client: PgLikeClient;
  /** Table name, already created. Default "idempotency_keys". */
  table?: string;
  /** Schema name. Default "public". */
  schema?: string;
}

/** Migration for the table this adapter expects. */
export function idempotencyTableSql(table = "idempotency_keys", schema = "public"): string {
  return `CREATE TABLE IF NOT EXISTS ${schema}.${table} (
  key         text PRIMARY KEY,
  record      jsonb NOT NULL,
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ${table}_expires_at_idx ON ${schema}.${table} (expires_at);`;
}

function validateIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${label} for postgresAdapter: ${value}`);
  }
  return value;
}

/**
 * Postgres backed storage. The claim is one INSERT ... ON CONFLICT statement,
 * so concurrent requests are serialised by the primary key rather than by a
 * read then write in application code. Expired rows are reclaimed by the same
 * statement, which keeps the table self cleaning under normal traffic.
 */
export function postgresAdapter(options: PostgresAdapterOptions): IdempotencyAdapter {
  if (!options?.client) {
    throw new Error(
      "postgresAdapter requires a client, for example a pg Pool: postgresAdapter({ client: pool }).",
    );
  }
  const table = validateIdentifier(options.table ?? "idempotency_keys", "table");
  const schema = validateIdentifier(options.schema ?? "public", "schema");
  const target = `${schema}.${table}`;
  const client = options.client;

  return {
    name: "postgres",

    async begin(key: string, record: IdempotencyRecord, ttlMs: number): Promise<BeginResult> {
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();
      const claimed = await client.query(
        `INSERT INTO ${target} (key, record, expires_at)
         VALUES ($1, $2::jsonb, $3::timestamptz)
         ON CONFLICT (key) DO UPDATE
           SET record = EXCLUDED.record, expires_at = EXCLUDED.expires_at
           WHERE ${target}.expires_at <= now()
         RETURNING key`,
        [key, JSON.stringify(record), expiresAt],
      );

      if (claimed.rows.length > 0) return { acquired: true };

      const existing = await client.query(
        `SELECT record FROM ${target} WHERE key = $1 AND expires_at > now()`,
        [key],
      );
      const row = existing.rows[0]?.record;
      return {
        acquired: false,
        existing: row ? (typeof row === "string" ? (JSON.parse(row) as IdempotencyRecord) : (row as IdempotencyRecord)) : null,
      };
    },

    async complete(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void> {
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();
      await client.query(
        `UPDATE ${target} SET record = $2::jsonb, expires_at = $3::timestamptz WHERE key = $1`,
        [key, JSON.stringify(record), expiresAt],
      );
    },

    async release(key: string): Promise<void> {
      await client.query(`DELETE FROM ${target} WHERE key = $1`, [key]);
    },

    async get(key: string): Promise<IdempotencyRecord | null> {
      const result = await client.query(
        `SELECT record FROM ${target} WHERE key = $1 AND expires_at > now()`,
        [key],
      );
      const row = result.rows[0]?.record;
      if (!row) return null;
      return typeof row === "string" ? (JSON.parse(row) as IdempotencyRecord) : (row as IdempotencyRecord);
    },
  };
}
