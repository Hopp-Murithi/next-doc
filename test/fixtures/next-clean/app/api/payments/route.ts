import { withIdempotency } from "@wamasoda/next-doc/idempotency";
import { memoryAdapter } from "@wamasoda/next-doc/idempotency/memory";

export const POST = withIdempotency(
  async (request: Request) => {
    const body = await request.json();
    return Response.json({ charged: body.amount });
  },
  { adapter: memoryAdapter(), ttlSeconds: 86400 },
);
