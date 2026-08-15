# idempotency plugin

```bash
npx @wamasoda/nextdoc idempotency
```

This page covers the static scan. The runtime wrapper that fixes what the scan finds is documented separately in [Idempotency runtime](../05-idempotency-runtime.md).

## What it checks

Route handlers, Server Actions and API routes on money handling paths that show no sign of duplicate request protection.

## Why it matters

Retries are normal. A user double clicks, a mobile connection drops after the request left the phone but before the response arrived, a queue redelivers, a load balancer times out and the client tries again. For a read, that costs nothing. For a charge, it costs a customer twice, and the second charge is a support ticket, a refund, and a chargeback fee.

Payment providers hand you the tool for this: an idempotency key. What they cannot do is notice that your handler never reads one.

## This is a heuristic

The rule cannot prove a handler is unprotected. It reports what it can see, and the wording says so:

```text
✗ app/api/payments/route.ts has no idempotency key handling detected,
  possible missing idempotency protection
```

Not "missing protection". Possible. When it is wrong, silence it:

```ts
// nextdoc-ignore idempotency
export async function POST(request: Request) {}
```

## Rules

### `IDEM_UNPROTECTED_ROUTE` (error)

A mutation handler on a money handling path with no idempotency concept detected.

**Paths that qualify** (configurable, replaces the default list):

`payment`, `payments`, `checkout`, `subscription`, `subscriptions`, `webhook`, `webhooks`, `charge`, `charges`, `refund`, `refunds`, `order`, `orders`, `invoice`, `billing`, `transfer`, `payout`

**Handlers it recognises**, across frameworks:

| Shape | Framework |
| --- | --- |
| `export async function POST/PUT/PATCH` | Next.js Route Handler |
| `export const POST = ...` | Next.js Route Handler |
| `export async function action` | Remix, React Router |
| `app.post(...)`, `router.post(...)` | Express style server in the repo |
| `export default async function handler` | Pages Router API route |
| any exported async function in a `"use server"` file | Next.js Server Action |

**Markers that count as protection** (defaults, extended by `idempotency.keywords`):

`idempotencyKey`, `idempotency_key`, `Idempotency-Key`, `withIdempotency`, `dedupe`, `deduplicate`

### `IDEM_KEY_NOT_PERSISTED` (warning)

The file reads an idempotency key but never stores it anywhere. Reading a key and not persisting it deduplicates nothing. Storage evidence includes `withIdempotency`, a `.set(...)`, a `SETNX`, an `INSERT INTO`, an `upsert`, or a call through a `prisma.`, `db.`, `redis` or `kv.` client.

## Configuration

```json
{
  "idempotency": {
    "pathPatterns": ["payment", "checkout", "webhook", "ledger", "wallet"],
    "keywords": ["myCustomDedupeHelper"]
  }
}
```

`pathPatterns` replaces the default list. `keywords` is appended to the defaults.

## Fixing what it finds

```ts
import { withIdempotency } from "@wamasoda/nextdoc/idempotency";
import { redisAdapter } from "@wamasoda/nextdoc/idempotency/redis";

export const POST = withIdempotency(
  async (request: Request) => {
    const { amount } = await request.json();
    const charge = await stripe.paymentIntents.create({ amount, currency: "usd" });
    return Response.json({ id: charge.id });
  },
  { adapter: redisAdapter({ client: redis }) },
);
```

Full API, storage adapters and edge case behaviour: [Idempotency runtime](../05-idempotency-runtime.md).
