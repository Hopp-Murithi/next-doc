/**
 * Storage contract for idempotency records. Zero dependencies on purpose: this
 * type is imported by application code, so it must never drag a client library
 * into an app bundle.
 */

export interface StoredResponse {
  status: number;
  headers: Array<[string, string]>;
  body: string;
}

export interface IdempotencyRecord {
  status: "in_flight" | "completed";
  /** Hash of the request that claimed the key, or null when body checking is off. */
  fingerprint: string | null;
  response?: StoredResponse;
  /** Arbitrary JSON result, used by the Server Action helper. */
  value?: unknown;
  createdAt: number;
  completedAt?: number;
}

export type BeginResult =
  | { acquired: true }
  | { acquired: false; existing: IdempotencyRecord | null };

export interface IdempotencyAdapter {
  readonly name: string;
  /**
   * Atomically claims `key` if it is free. Must be a single set-if-not-exists
   * operation, never a read followed by a write: two requests arriving in the
   * same millisecond are the exact case this whole library exists for.
   */
  begin(key: string, record: IdempotencyRecord, ttlMs: number): Promise<BeginResult>;
  /** Overwrites the claimed key with the finished record. */
  complete(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void>;
  /** Frees a claimed key so the client can retry, used when the handler throws. */
  release(key: string): Promise<void>;
  get(key: string): Promise<IdempotencyRecord | null>;
  /** Optional teardown for adapters that own a connection. */
  close?(): Promise<void>;
}

export interface IdempotencyLogEvent {
  event: "acquired" | "replayed" | "conflict" | "mismatch" | "released" | "storage-error" | "skipped";
  key: string;
  adapter: string;
  detail?: string;
}

export interface IdempotencyOptions {
  /** Storage backend. Required, there is no silent in-memory default in production. */
  adapter: IdempotencyAdapter;
  /** Header carrying the key. Default "Idempotency-Key". */
  keyHeader?: string;
  /** How long a key is remembered. Default 86400 (24 hours). */
  ttlSeconds?: number;
  /**
   * What to do when the header is absent.
   * "reject" (default) returns 400. "passthrough" runs the handler unprotected,
   * which is useful while rolling the header out to existing clients.
   */
  onMissingKey?: "reject" | "passthrough";
  /**
   * Reject a key reused with a different request body. Default true: silently
   * returning the first response for a different payload is a correctness bug.
   */
  requireMatchingBody?: boolean;
  /**
   * Behaviour when the storage backend is unreachable.
   * "fail-closed" (default) returns 503 rather than risking a double charge.
   * "fail-open" runs the handler anyway, accepting that risk for availability.
   */
  onStorageError?: "fail-closed" | "fail-open";
  /** Namespace prepended to every key. Use it to scope keys per route or per user. */
  scope?: string | ((request: Request) => string | Promise<string>);
  /** Maximum accepted key length. Default 255. */
  maxKeyLength?: number;
  /** Decides which responses are worth replaying. Default: status below 500. */
  shouldPersist?: (response: Response) => boolean;
  /** Observability hook. Never receives request bodies. */
  onEvent?: (event: IdempotencyLogEvent) => void;
}

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";
  constructor(message = "A request with this idempotency key is already in flight") {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export class IdempotencyMismatchError extends Error {
  readonly code = "IDEMPOTENCY_KEY_REUSED";
  constructor(message = "This idempotency key was already used with a different request") {
    super(message);
    this.name = "IdempotencyMismatchError";
  }
}

export class IdempotencyStorageError extends Error {
  readonly code = "IDEMPOTENCY_STORAGE_UNAVAILABLE";
  override readonly cause: unknown;
  constructor(cause: unknown) {
    super("Idempotency storage is unavailable");
    this.name = "IdempotencyStorageError";
    this.cause = cause;
  }
}
