import type {
  IdempotencyAdapter,
  IdempotencyLogEvent,
  IdempotencyOptions,
  IdempotencyRecord,
  StoredResponse,
} from "./types.js";
import {
  IdempotencyConflictError,
  IdempotencyMismatchError,
  IdempotencyStorageError,
} from "./types.js";

export type {
  IdempotencyAdapter,
  IdempotencyOptions,
  IdempotencyRecord,
  IdempotencyLogEvent,
  StoredResponse,
  BeginResult,
} from "./types.js";
export {
  IdempotencyConflictError,
  IdempotencyMismatchError,
  IdempotencyStorageError,
} from "./types.js";

const DEFAULT_HEADER = "Idempotency-Key";
const DEFAULT_TTL_SECONDS = 86_400;
const DEFAULT_MAX_KEY_LENGTH = 255;
const KEY_PATTERN = /^[A-Za-z0-9._:@/-]+$/;

/** Headers that must not be replayed from a stored response. */
const VOLATILE_HEADERS = new Set(["date", "content-length", "transfer-encoding", "connection", "keep-alive"]);

type Handler<Args extends unknown[]> = (request: Request, ...args: Args) => Response | Promise<Response>;

interface ResolvedOptions {
  adapter: IdempotencyAdapter;
  keyHeader: string;
  ttlMs: number;
  onMissingKey: "reject" | "passthrough";
  requireMatchingBody: boolean;
  onStorageError: "fail-closed" | "fail-open";
  scope: IdempotencyOptions["scope"];
  maxKeyLength: number;
  shouldPersist: (response: Response) => boolean;
  onEvent: (event: IdempotencyLogEvent) => void;
}

function resolve(options: IdempotencyOptions): ResolvedOptions {
  if (!options || !options.adapter) {
    // Fail at startup, not at the first request in production.
    throw new Error(
      "withIdempotency requires an adapter. Import one from @wamasoda/next-doc/idempotency/memory, /redis or /postgres.",
    );
  }
  return {
    adapter: options.adapter,
    keyHeader: options.keyHeader ?? DEFAULT_HEADER,
    ttlMs: (options.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000,
    onMissingKey: options.onMissingKey ?? "reject",
    requireMatchingBody: options.requireMatchingBody ?? true,
    onStorageError: options.onStorageError ?? "fail-closed",
    scope: options.scope,
    maxKeyLength: options.maxKeyLength ?? DEFAULT_MAX_KEY_LENGTH,
    shouldPersist: options.shouldPersist ?? ((response) => response.status < 500),
    onEvent: options.onEvent ?? (() => {}),
  };
}

function problem(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** SHA-256 where available, with a deterministic fallback for exotic runtimes. */
async function hash(input: string): Promise<string> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (subtle) {
    const data = new TextEncoder().encode(input);
    const digest = await subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
    return hex;
  }
  let h1 = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h1 ^= input.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return `fnv1a-${h1.toString(16)}-${input.length}`;
}

async function fingerprintOf(request: Request): Promise<string> {
  let body = "";
  try {
    body = await request.clone().text();
  } catch {
    body = "";
  }
  const url = new URL(request.url);
  return hash(`${request.method} ${url.pathname}${url.search}\n${body}`);
}

async function serialize(response: Response): Promise<StoredResponse> {
  const clone = response.clone();
  const headers: Array<[string, string]> = [];
  clone.headers.forEach((value, name) => {
    if (!VOLATILE_HEADERS.has(name.toLowerCase())) headers.push([name, value]);
  });
  return { status: clone.status, headers, body: await clone.text() };
}

function replay(stored: StoredResponse): Response {
  const headers = new Headers(stored.headers);
  headers.set("Idempotent-Replay", "true");
  return new Response(stored.body, { status: stored.status, headers });
}

function validateKey(key: string, maxLength: number): string | null {
  if (key.length === 0) return "The idempotency key is empty.";
  if (key.length > maxLength) return `The idempotency key is longer than ${maxLength} characters.`;
  if (!KEY_PATTERN.test(key)) {
    return "The idempotency key contains unsupported characters. Use letters, digits and . _ : @ / - only.";
  }
  return null;
}

async function scopedKey(options: ResolvedOptions, request: Request, key: string): Promise<string> {
  if (!options.scope) return key;
  const prefix = typeof options.scope === "function" ? await options.scope(request) : options.scope;
  return prefix ? `${prefix}:${key}` : key;
}

/**
 * Wraps a Web standard handler so retries with the same Idempotency-Key are
 * safe. Works with Next.js Route Handlers, Remix and React Router resource
 * routes, Hono, and anything else built on Request and Response.
 *
 * Behaviour, all configurable and documented in docs/05-idempotency-runtime.md:
 *   no key             400, or run unprotected with onMissingKey "passthrough"
 *   key in flight      409, never a queue and never a wait
 *   key completed      the stored response, replayed verbatim
 *   key reused, new body   422
 *   storage down       503 by default, because a blocked payment is recoverable
 *                      and a double charge is not
 */
export function withIdempotency<Args extends unknown[]>(
  handler: Handler<Args>,
  options: IdempotencyOptions,
): Handler<Args> {
  const opts = resolve(options);

  return async function idempotentHandler(request: Request, ...args: Args): Promise<Response> {
    const rawKey = request.headers.get(opts.keyHeader);

    if (!rawKey) {
      if (opts.onMissingKey === "passthrough") {
        opts.onEvent({ event: "skipped", key: "", adapter: opts.adapter.name, detail: "no key header" });
        return handler(request, ...args);
      }
      return problem(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        `This endpoint requires an ${opts.keyHeader} header so retries cannot duplicate the operation.`,
      );
    }

    const invalid = validateKey(rawKey, opts.maxKeyLength);
    if (invalid) return problem(400, "IDEMPOTENCY_KEY_INVALID", invalid);

    const key = await scopedKey(opts, request, rawKey);
    const fingerprint = opts.requireMatchingBody ? await fingerprintOf(request) : null;
    const record: IdempotencyRecord = { status: "in_flight", fingerprint, createdAt: Date.now() };

    let begin: Awaited<ReturnType<IdempotencyAdapter["begin"]>>;
    try {
      begin = await opts.adapter.begin(key, record, opts.ttlMs);
    } catch (error) {
      opts.onEvent({
        event: "storage-error",
        key,
        adapter: opts.adapter.name,
        detail: (error as Error).message,
      });
      if (opts.onStorageError === "fail-open") return handler(request, ...args);
      return problem(
        503,
        "IDEMPOTENCY_STORAGE_UNAVAILABLE",
        "Could not verify whether this request was already processed. Retry with the same idempotency key.",
      );
    }

    if (!begin.acquired) {
      const existing = begin.existing;

      if (existing && fingerprint && existing.fingerprint && existing.fingerprint !== fingerprint) {
        opts.onEvent({ event: "mismatch", key, adapter: opts.adapter.name });
        return problem(
          422,
          "IDEMPOTENCY_KEY_REUSED",
          "This idempotency key was already used with a different request body. Use a new key for a new operation.",
        );
      }

      if (existing?.status === "completed" && existing.response) {
        opts.onEvent({ event: "replayed", key, adapter: opts.adapter.name });
        return replay(existing.response);
      }

      opts.onEvent({ event: "conflict", key, adapter: opts.adapter.name });
      return problem(
        409,
        "IDEMPOTENCY_REQUEST_IN_FLIGHT",
        "A request with this idempotency key is still being processed. Retry in a moment.",
      );
    }

    opts.onEvent({ event: "acquired", key, adapter: opts.adapter.name });

    let response: Response;
    try {
      response = await handler(request, ...args);
    } catch (error) {
      // The operation never completed, so the key must not stay claimed.
      await opts.adapter.release(key).catch(() => {});
      opts.onEvent({ event: "released", key, adapter: opts.adapter.name, detail: "handler threw" });
      throw error;
    }

    if (!opts.shouldPersist(response)) {
      await opts.adapter.release(key).catch(() => {});
      opts.onEvent({ event: "released", key, adapter: opts.adapter.name, detail: `status ${response.status}` });
      return response;
    }

    const stored = await serialize(response);
    try {
      await opts.adapter.complete(
        key,
        { status: "completed", fingerprint, response: stored, createdAt: record.createdAt, completedAt: Date.now() },
        opts.ttlMs,
      );
    } catch (error) {
      // The work succeeded. Losing the record only costs replay ability, so the
      // caller still gets their response.
      opts.onEvent({
        event: "storage-error",
        key,
        adapter: opts.adapter.name,
        detail: `could not store response: ${(error as Error).message}`,
      });
    }

    return response;
  };
}

export interface IdempotentRunOptions
  extends Omit<IdempotencyOptions, "keyHeader" | "onMissingKey" | "shouldPersist" | "scope"> {
  scope?: string;
}

/**
 * The same guarantees without a Request, for Server Actions and background
 * jobs. The return value is stored as JSON, so it must be JSON serializable.
 *
 * Throws IdempotencyConflictError while an identical call is in flight, and
 * IdempotencyMismatchError when a key is reused with different arguments.
 */
export function createIdempotency(options: IdempotentRunOptions) {
  const adapter = options.adapter;
  if (!adapter) {
    throw new Error(
      "createIdempotency requires an adapter. Import one from @wamasoda/next-doc/idempotency/memory, /redis or /postgres.",
    );
  }
  const ttlMs = (options.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000;
  const maxKeyLength = options.maxKeyLength ?? DEFAULT_MAX_KEY_LENGTH;
  const onStorageError = options.onStorageError ?? "fail-closed";
  const requireMatchingBody = options.requireMatchingBody ?? true;
  const onEvent = options.onEvent ?? (() => {});

  return {
    /**
     * Runs `fn` at most once per key. On a repeat call within the TTL the stored
     * result is returned without running `fn` again.
     */
    async run<T>(key: string, fn: () => Promise<T> | T, args?: unknown): Promise<T> {
      const invalid = validateKey(key, maxKeyLength);
      if (invalid) throw new Error(invalid);

      const scoped = options.scope ? `${options.scope}:${key}` : key;
      const fingerprint = requireMatchingBody ? await hash(JSON.stringify(args ?? null)) : null;
      const createdAt = Date.now();

      let begin: Awaited<ReturnType<IdempotencyAdapter["begin"]>>;
      try {
        begin = await adapter.begin(scoped, { status: "in_flight", fingerprint, createdAt }, ttlMs);
      } catch (error) {
        onEvent({ event: "storage-error", key: scoped, adapter: adapter.name, detail: (error as Error).message });
        if (onStorageError === "fail-open") return fn();
        throw new IdempotencyStorageError(error);
      }

      if (!begin.acquired) {
        const existing = begin.existing;
        if (existing && fingerprint && existing.fingerprint && existing.fingerprint !== fingerprint) {
          onEvent({ event: "mismatch", key: scoped, adapter: adapter.name });
          throw new IdempotencyMismatchError();
        }
        if (existing?.status === "completed") {
          onEvent({ event: "replayed", key: scoped, adapter: adapter.name });
          return existing.value as T;
        }
        onEvent({ event: "conflict", key: scoped, adapter: adapter.name });
        throw new IdempotencyConflictError();
      }

      onEvent({ event: "acquired", key: scoped, adapter: adapter.name });

      let value: T;
      try {
        value = await fn();
      } catch (error) {
        await adapter.release(scoped).catch(() => {});
        onEvent({ event: "released", key: scoped, adapter: adapter.name, detail: "callback threw" });
        throw error;
      }

      try {
        await adapter.complete(
          scoped,
          { status: "completed", fingerprint, value, createdAt, completedAt: Date.now() },
          ttlMs,
        );
      } catch (error) {
        onEvent({
          event: "storage-error",
          key: scoped,
          adapter: adapter.name,
          detail: `could not store result: ${(error as Error).message}`,
        });
      }

      return value;
    },
  };
}
