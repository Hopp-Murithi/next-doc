import { describe, expect, it, vi } from "vitest";
import { withIdempotency, createIdempotency } from "../../src/runtime/idempotency.js";
import { IdempotencyConflictError, IdempotencyMismatchError } from "../../src/runtime/types.js";
import type { IdempotencyAdapter, IdempotencyRecord } from "../../src/runtime/types.js";
import { memoryAdapter } from "../../src/runtime/adapters/memory.js";

const URL_BASE = "https://app.test/api/payments";

function post(body: unknown, key?: string, extraHeaders: Record<string, string> = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json", ...extraHeaders };
  if (key) headers["Idempotency-Key"] = key;
  return new Request(URL_BASE, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("withIdempotency", () => {
  it("runs the handler once and replays the stored response on retry", async () => {
    const adapter = memoryAdapter();
    const handler = vi.fn(async () => Response.json({ chargeId: "ch_1" }, { status: 201 }));
    const route = withIdempotency(handler, { adapter });

    const first = await route(post({ amount: 100 }, "key-1"));
    const second = await route(post({ amount: 100 }, "key-1"));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual({ chargeId: "ch_1" });
    expect(second.headers.get("Idempotent-Replay")).toBe("true");
    expect(first.headers.get("Idempotent-Replay")).toBeNull();
  });

  it("returns 409 while an identical request is still in flight, without queueing", async () => {
    const adapter = memoryAdapter();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const route = withIdempotency(
      async () => {
        await gate;
        return Response.json({ ok: true });
      },
      { adapter },
    );

    const inflight = route(post({ amount: 100 }, "key-race"));
    // Let the first request claim the key before the second arrives.
    await new Promise((resolve) => setImmediate(resolve));
    const second = await route(post({ amount: 100 }, "key-race"));

    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("IDEMPOTENCY_REQUEST_IN_FLIGHT");

    release!();
    expect((await inflight).status).toBe(200);
  });

  it("lets only one of many simultaneous requests through", async () => {
    const adapter = memoryAdapter();
    let calls = 0;
    const route = withIdempotency(
      async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return Response.json({ calls });
      },
      { adapter },
    );

    const responses = await Promise.all(
      Array.from({ length: 20 }, () => route(post({ amount: 100 }, "key-storm"))),
    );

    expect(calls).toBe(1);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(19);
  });

  it("rejects a key reused with a different body", async () => {
    const adapter = memoryAdapter();
    const route = withIdempotency(async () => Response.json({ ok: true }), { adapter });

    await route(post({ amount: 100 }, "key-2"));
    const reused = await route(post({ amount: 999 }, "key-2"));

    expect(reused.status).toBe(422);
    expect((await reused.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("allows a key reused with a different body when body checking is off", async () => {
    const adapter = memoryAdapter();
    const route = withIdempotency(async () => Response.json({ ok: true }), {
      adapter,
      requireMatchingBody: false,
    });

    await route(post({ amount: 100 }, "key-3"));
    const reused = await route(post({ amount: 999 }, "key-3"));

    expect(reused.status).toBe(200);
    expect(reused.headers.get("Idempotent-Replay")).toBe("true");
  });

  it("rejects a missing key by default and passes through when configured to", async () => {
    const adapter = memoryAdapter();
    const handler = vi.fn(async () => Response.json({ ok: true }));

    const strict = withIdempotency(handler, { adapter });
    const rejected = await strict(post({ amount: 1 }));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(handler).not.toHaveBeenCalled();

    const lenient = withIdempotency(handler, { adapter, onMissingKey: "passthrough" });
    const allowed = await lenient(post({ amount: 1 }));
    expect(allowed.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("rejects keys that are too long or contain unexpected characters", async () => {
    const adapter = memoryAdapter();
    const route = withIdempotency(async () => Response.json({ ok: true }), { adapter });

    const long = await route(post({}, "k".repeat(256)));
    expect(long.status).toBe(400);
    expect((await long.json()).error.code).toBe("IDEMPOTENCY_KEY_INVALID");

    const weird = await route(post({}, "key with spaces\n"));
    expect(weird.status).toBe(400);
  });

  it("fails closed when storage is unreachable", async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const route = withIdempotency(handler, { adapter: brokenAdapter() });

    const response = await route(post({ amount: 1 }, "key-4"));

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("IDEMPOTENCY_STORAGE_UNAVAILABLE");
    expect(handler).not.toHaveBeenCalled();
  });

  it("fails open when explicitly configured to accept the risk", async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const route = withIdempotency(handler, { adapter: brokenAdapter(), onStorageError: "fail-open" });

    const response = await route(post({ amount: 1 }, "key-5"));

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("frees the key when the handler throws, so a retry can proceed", async () => {
    const adapter = memoryAdapter();
    let attempt = 0;
    const route = withIdempotency(
      async () => {
        attempt++;
        if (attempt === 1) throw new Error("gateway timeout");
        return Response.json({ attempt });
      },
      { adapter },
    );

    await expect(route(post({ amount: 1 }, "key-6"))).rejects.toThrow("gateway timeout");
    const retry = await route(post({ amount: 1 }, "key-6"));

    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ attempt: 2 });
  });

  it("does not store server errors, so a retry actually retries", async () => {
    const adapter = memoryAdapter();
    let attempt = 0;
    const route = withIdempotency(
      async () => {
        attempt++;
        return attempt === 1
          ? new Response("upstream down", { status: 502 })
          : Response.json({ attempt }, { status: 201 });
      },
      { adapter },
    );

    expect((await route(post({ amount: 1 }, "key-7"))).status).toBe(502);
    const retry = await route(post({ amount: 1 }, "key-7"));
    expect(retry.status).toBe(201);
  });

  it("replays client errors, because a 4xx is a real outcome of the request", async () => {
    const adapter = memoryAdapter();
    const handler = vi.fn(async () => Response.json({ error: "card_declined" }, { status: 402 }));
    const route = withIdempotency(handler, { adapter });

    expect((await route(post({ amount: 1 }, "key-8"))).status).toBe(402);
    expect((await route(post({ amount: 1 }, "key-8"))).status).toBe(402);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("forgets a key once its TTL has passed", async () => {
    const adapter = memoryAdapter();
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const route = withIdempotency(handler, { adapter, ttlSeconds: 0.01 });

    await route(post({ amount: 1 }, "key-9"));
    await new Promise((resolve) => setTimeout(resolve, 25));
    await route(post({ amount: 1 }, "key-9"));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("scopes keys so the same key on two routes does not collide", async () => {
    const adapter = memoryAdapter();
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const refunds = withIdempotency(handler, { adapter, scope: "refunds" });
    const charges = withIdempotency(handler, { adapter, scope: "charges" });

    await refunds(post({ amount: 1 }, "same-key"));
    await charges(post({ amount: 1 }, "same-key"));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("preserves the status and headers of the original response on replay", async () => {
    const adapter = memoryAdapter();
    const route = withIdempotency(
      async () =>
        new Response(JSON.stringify({ id: 1 }), {
          status: 201,
          headers: { "content-type": "application/json", "x-charge-id": "ch_42", date: "ignored" },
        }),
      { adapter },
    );

    await route(post({ amount: 1 }, "key-10"));
    const replayed = await route(post({ amount: 1 }, "key-10"));

    expect(replayed.status).toBe(201);
    expect(replayed.headers.get("x-charge-id")).toBe("ch_42");
    expect(replayed.headers.get("content-type")).toBe("application/json");
  });

  it("refuses to start without an adapter", () => {
    // @ts-expect-error deliberately omitting the required adapter
    expect(() => withIdempotency(async () => new Response("ok"), {})).toThrow(/requires an adapter/);
  });

  it("reports events without ever exposing a request body", async () => {
    const events: string[] = [];
    const adapter = memoryAdapter();
    const route = withIdempotency(async () => Response.json({ secret: "card-4242" }), {
      adapter,
      onEvent: (event) => events.push(`${event.event}:${event.key}`),
    });

    await route(post({ pan: "4242424242424242" }, "key-11"));
    await route(post({ pan: "4242424242424242" }, "key-11"));

    expect(events).toEqual(["acquired:key-11", "replayed:key-11"]);
  });
});

describe("createIdempotency for Server Actions", () => {
  it("runs the callback once and returns the stored value afterwards", async () => {
    const idem = createIdempotency({ adapter: memoryAdapter() });
    const work = vi.fn(async () => ({ orderId: "ord_1" }));

    const first = await idem.run("action-1", work, { amount: 10 });
    const second = await idem.run("action-1", work, { amount: 10 });

    expect(work).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("throws a conflict while the same key is in flight", async () => {
    const idem = createIdempotency({ adapter: memoryAdapter() });
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const running = idem.run("action-2", async () => {
      await gate;
      return "done";
    });
    await new Promise((resolve) => setImmediate(resolve));

    await expect(idem.run("action-2", async () => "done")).rejects.toBeInstanceOf(IdempotencyConflictError);
    release!();
    await running;
  });

  it("throws a mismatch when a key is reused with different arguments", async () => {
    const idem = createIdempotency({ adapter: memoryAdapter() });
    await idem.run("action-3", async () => "a", { amount: 10 });

    await expect(idem.run("action-3", async () => "a", { amount: 20 })).rejects.toBeInstanceOf(
      IdempotencyMismatchError,
    );
  });

  it("frees the key when the callback throws", async () => {
    const idem = createIdempotency({ adapter: memoryAdapter() });
    await expect(idem.run("action-4", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(idem.run("action-4", async () => "recovered")).resolves.toBe("recovered");
  });
});

function brokenAdapter(): IdempotencyAdapter {
  const fail = async (): Promise<never> => {
    throw new Error("ECONNREFUSED");
  };
  return {
    name: "broken",
    begin: fail,
    complete: fail,
    release: fail,
    get: fail as () => Promise<IdempotencyRecord | null>,
  };
}
