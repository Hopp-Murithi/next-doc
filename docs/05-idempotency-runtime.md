# Idempotency runtime

```ts
import { withIdempotency } from "@hopp/next-doc/idempotency";
```

The static plugin finds handlers that can charge a customer twice. This is the part that stops it happening.

It is a separate entry point from the CLI, with zero dependencies of its own, so importing it into a Route Handler never pulls the scanner, commander or the glob code into your production bundle. The core wrapper is about 2.3kb minified and gzipped, and CI fails if that grows past 3kb.

## Quick start

```ts
// app/api/payments/route.ts
import { withIdempotency } from "@hopp/next-doc/idempotency";
import { redisAdapter } from "@hopp/next-doc/idempotency/redis";
import { redis } from "@/lib/redis";

export const POST = withIdempotency(
  async (request: Request) => {
    const { amount } = await request.json();
    const charge = await stripe.paymentIntents.create({ amount, currency: "usd" });
    return Response.json({ id: charge.id }, { status: 201 });
  },
  {
    adapter: redisAdapter({ client: redis }),
    keyHeader: "Idempotency-Key", // default
    ttlSeconds: 86400, // default, 24 hours
  },
);
```

The client sends a key it generates once per logical operation and reuses across retries:

```ts
await fetch("/api/payments", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "Idempotency-Key": operationId, // stable across retries of this one operation
  },
  body: JSON.stringify({ amount: 2500 }),
});
```

Works anywhere the platform speaks Web standard `Request` and `Response`: Next.js Route Handlers (Node and Edge), Remix and React Router resource routes, Hono, Cloudflare Workers, Deno, Bun.

## Behaviour

| Situation | Response | Configurable |
| --- | --- | --- |
| No key header | `400 IDEMPOTENCY_KEY_REQUIRED` | `onMissingKey: "passthrough"` runs the handler unprotected |
| Key too long, or bad characters | `400 IDEMPOTENCY_KEY_INVALID` | `maxKeyLength`, default 255 |
| Key in flight | `409 IDEMPOTENCY_REQUEST_IN_FLIGHT` | no |
| Key completed | The stored response, verbatim, plus `Idempotent-Replay: true` | no |
| Key reused with a different body | `422 IDEMPOTENCY_KEY_REUSED` | `requireMatchingBody: false` to allow it |
| Storage unreachable | `503 IDEMPOTENCY_STORAGE_UNAVAILABLE` | `onStorageError: "fail-open"` |
| Handler threw | The error propagates, the key is released | no |
| Handler returned 5xx | Returned as is, the key is released | `shouldPersist` |

Error responses are JSON: `{ "error": { "code": "...", "message": "..." } }`.

### Why 409 rather than waiting

Waiting on an in flight request means holding a connection for an unbounded time, which turns one slow payment into a queue of stuck requests. A 409 tells the client exactly what to do: retry in a moment with the same key.

### Why fail closed by default

If storage is down, the wrapper cannot tell a first attempt from a retry. Failing closed returns 503 and the customer retries later. Failing open runs the handler and risks a duplicate charge. A blocked payment is recoverable. A double charge is a refund, a support ticket and a chargeback fee. Set `onStorageError: "fail-open"` if your risk calculus differs, and know what you are choosing.

### Why 5xx responses are not stored

An upstream timeout is not an outcome, it is an absence of one. Storing it would make every retry replay the failure forever. Client errors (4xx) are stored, because "this card was declined" is a real, repeatable result of that exact request.

## Options

```ts
interface IdempotencyOptions {
  adapter: IdempotencyAdapter;          // required
  keyHeader?: string;                   // "Idempotency-Key"
  ttlSeconds?: number;                  // 86400
  onMissingKey?: "reject" | "passthrough";       // "reject"
  requireMatchingBody?: boolean;                 // true
  onStorageError?: "fail-closed" | "fail-open";  // "fail-closed"
  scope?: string | ((request: Request) => string | Promise<string>);
  maxKeyLength?: number;                // 255
  shouldPersist?: (response: Response) => boolean; // status < 500
  onEvent?: (event: IdempotencyLogEvent) => void;
}
```

### `scope`

Namespaces keys so the same key on two endpoints does not collide, and so one user's key cannot address another user's record:

```ts
withIdempotency(handler, {
  adapter,
  scope: async (request) => `refunds:${await userIdFrom(request)}`,
});
```

### `onEvent`

Observability without leaking anything. Events are `acquired`, `replayed`, `conflict`, `mismatch`, `released`, `storage-error` and `skipped`, each with the key and the adapter name. Request bodies are never included.

```ts
withIdempotency(handler, {
  adapter,
  onEvent: (event) => metrics.increment(`idempotency.${event.event}`),
});
```

### `ttlSeconds`

24 hours by default. Long enough that a client retrying after a long outage still gets deduplicated, short enough that keys do not accumulate forever. Match it to how long your clients keep retrying.

## Server Actions and background jobs

There is no `Request` in a Server Action, so the wrapper form does not apply. Use the runner:

```ts
"use server";

import { createIdempotency } from "@hopp/next-doc/idempotency";
import { redisAdapter } from "@hopp/next-doc/idempotency/redis";

const idempotency = createIdempotency({
  adapter: redisAdapter({ client: redis }),
  scope: "checkout",
});

export async function checkout(formData: FormData) {
  const operationId = String(formData.get("operationId"));
  const amount = Number(formData.get("amount"));

  return idempotency.run(operationId, async () => {
    const charge = await stripe.paymentIntents.create({ amount, currency: "usd" });
    return { id: charge.id };
  }, { amount });
}
```

- The return value is stored as JSON, so it must be JSON serializable.
- The third argument is the argument fingerprint. Pass the inputs that define the operation, and reusing a key with different inputs throws `IdempotencyMismatchError`.
- A call while the same key is in flight throws `IdempotencyConflictError`.
- Generate `operationId` when the form renders, not when it submits, so a double submit sends the same key.

Errors thrown: `IdempotencyConflictError`, `IdempotencyMismatchError`, `IdempotencyStorageError`. All are exported from `@hopp/next-doc/idempotency`.

## Adapters

Adapters are separate entry points. You import the one you use, so nothing else reaches your bundle.

### Memory

```ts
import { memoryAdapter } from "@hopp/next-doc/idempotency/memory";

const adapter = memoryAdapter({ maxEntries: 10000 });
```

Development and tests only. Atomic within one process, but two server instances do not share it, and a restart forgets everything.

### Redis

```ts
import { redisAdapter } from "@hopp/next-doc/idempotency/redis";

// Bring your own client. ioredis, node-redis v4 and @upstash/redis all work.
const adapter = redisAdapter({ client: redis, prefix: "idem:" });

// Or hand over a connection string. Requires ioredis to be installed,
// and fails at startup with a clear message if it is not.
const adapter = redisAdapter({ url: process.env.REDIS_URL });
```

The claim is a single `SET key value PX ttl NX`. Two requests arriving in the same millisecond cannot both win it, across any number of server instances.

### Postgres

```ts
import { postgresAdapter, idempotencyTableSql } from "@hopp/next-doc/idempotency/postgres";
import { pool } from "@/lib/db";

const adapter = postgresAdapter({ client: pool, table: "idempotency_keys" });
```

Create the table first:

```sql
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  key         text PRIMARY KEY,
  record      jsonb NOT NULL,
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idempotency_keys_expires_at_idx
  ON public.idempotency_keys (expires_at);
```

`idempotencyTableSql(table, schema)` returns exactly that, if you would rather generate it in a migration.

The claim is one `INSERT ... ON CONFLICT (key) DO UPDATE ... WHERE expires_at <= now()`, so concurrency is settled by the primary key rather than by application code, and expired rows are reclaimed by the same statement. Table and schema names are validated as plain identifiers.

`client` is anything with a node-postgres style `query(text, values)`, which includes a `pg` `Pool`, a `pg` `Client`, and most pooler wrappers.

### Writing your own

```ts
interface IdempotencyAdapter {
  readonly name: string;
  begin(key, record, ttlMs): Promise<{ acquired: true } | { acquired: false; existing: IdempotencyRecord | null }>;
  complete(key, record, ttlMs): Promise<void>;
  release(key): Promise<void>;
  get(key): Promise<IdempotencyRecord | null>;
  close?(): Promise<void>;
}
```

One requirement above all: `begin` must be a single atomic set-if-not-exists. A read followed by a write loses the race that this library exists to win.

## Testing your handlers

```ts
import { withIdempotency } from "@hopp/next-doc/idempotency";
import { memoryAdapter } from "@hopp/next-doc/idempotency/memory";

const route = withIdempotency(handler, { adapter: memoryAdapter() });

const responses = await Promise.all(
  Array.from({ length: 20 }, () =>
    route(new Request("https://app.test/api/payments", {
      method: "POST",
      headers: { "Idempotency-Key": "same-key" },
      body: JSON.stringify({ amount: 100 }),
    })),
  ),
);

// One 200, nineteen 409s, and the handler ran exactly once.
```

That test ships with this package and runs on every commit, along with cases for TTL expiry, storage failure in both modes, key release after a throw, header replay and key scoping.
