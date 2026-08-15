import { describe, expect, it } from "vitest";
import { memoryAdapter } from "../../src/runtime/adapters/memory.js";
import { redisAdapter } from "../../src/runtime/adapters/redis.js";
import { postgresAdapter, idempotencyTableSql } from "../../src/runtime/adapters/postgres.js";
import type { IdempotencyRecord } from "../../src/runtime/types.js";

const record: IdempotencyRecord = { status: "in_flight", fingerprint: "abc", createdAt: Date.now() };

describe("memory adapter", () => {
  it("claims a key once and reports the existing record to the loser", async () => {
    const adapter = memoryAdapter();

    expect(await adapter.begin("k", record, 1000)).toEqual({ acquired: true });
    const second = await adapter.begin("k", record, 1000);

    expect(second.acquired).toBe(false);
    expect(second.acquired === false && second.existing?.fingerprint).toBe("abc");
  });

  it("expires records and allows the key to be claimed again", async () => {
    const adapter = memoryAdapter();
    await adapter.begin("k", record, 5);
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(await adapter.get("k")).toBeNull();
    expect(await adapter.begin("k", record, 1000)).toEqual({ acquired: true });
  });

  it("evicts the oldest entries past its cap", async () => {
    const adapter = memoryAdapter({ maxEntries: 2 });
    await adapter.begin("a", record, 10_000);
    await adapter.begin("b", record, 10_000);
    await adapter.begin("c", record, 10_000);

    expect(await adapter.get("a")).toBeNull();
    expect(await adapter.get("c")).not.toBeNull();
  });
});

describe("redis adapter", () => {
  /** Records the exact command each client flavour receives. */
  function spyClient(flavour: "ioredis" | "node-redis" | "upstash") {
    const commands: unknown[][] = [];
    const store = new Map<string, string>();
    const base = {
      get: async (key: string) => store.get(key) ?? null,
      del: async (key: string) => {
        store.delete(key);
        return 1;
      },
    };

    if (flavour === "ioredis") {
      return {
        commands,
        client: {
          ...base,
          call: async (...args: unknown[]) => {
            commands.push(args);
            const [, key, value, , , nx] = args as string[];
            if (nx === "NX" && store.has(key!)) return null;
            store.set(key!, value!);
            return "OK";
          },
        },
      };
    }

    if (flavour === "node-redis") {
      return {
        commands,
        client: {
          ...base,
          sendCommand: async (args: string[]) => {
            commands.push(args);
            const [, key, value, , , nx] = args;
            if (nx === "NX" && store.has(key!)) return null;
            store.set(key!, value!);
            return "OK";
          },
        },
      };
    }

    return {
      commands,
      client: {
        ...base,
        set: async (key: string, value: string, options?: { nx?: boolean }) => {
          commands.push([key, value, options]);
          if (options?.nx && store.has(key)) return null;
          store.set(key, value);
          return "OK";
        },
      },
    };
  }

  it.each(["ioredis", "node-redis", "upstash"] as const)(
    "claims atomically with a single set-if-not-exists on %s",
    async (flavour) => {
      const { client, commands } = spyClient(flavour);
      const adapter = redisAdapter({ client: client as never });

      expect(await adapter.begin("key", record, 60_000)).toEqual({ acquired: true });
      const second = await adapter.begin("key", record, 60_000);
      expect(second.acquired).toBe(false);
      expect(second.acquired === false && second.existing?.fingerprint).toBe("abc");

      const first = commands[0]!;
      const serialized = JSON.stringify(first);
      // One command, and it carries both the NX and the expiry.
      expect(serialized.toUpperCase()).toContain("NX");
      expect(serialized.toUpperCase()).toMatch(/PX|"px"/i);
    },
  );

  it("namespaces keys with a prefix", async () => {
    const { client, commands } = spyClient("ioredis");
    const adapter = redisAdapter({ client: client as never, prefix: "payments:" });
    await adapter.begin("abc", record, 1000);

    expect(String(commands[0]![1])).toBe("payments:abc");
  });

  it("refuses to construct without a client or a url", () => {
    expect(() => redisAdapter({})).toThrow(/requires either a client or a url/);
  });
});

describe("postgres adapter", () => {
  function spyClient(rows: Array<Record<string, unknown>> = []) {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    return {
      queries,
      client: {
        query: async (text: string, values?: unknown[]) => {
          queries.push({ text, values: values ?? [] });
          return { rows: text.startsWith("INSERT") ? rows : [] };
        },
      },
    };
  }

  it("claims with one INSERT ON CONFLICT statement rather than a read then write", async () => {
    const { client, queries } = spyClient([{ key: "k" }]);
    const adapter = postgresAdapter({ client });

    expect(await adapter.begin("k", record, 60_000)).toEqual({ acquired: true });
    expect(queries).toHaveLength(1);
    expect(queries[0]!.text).toContain("INSERT INTO public.idempotency_keys");
    expect(queries[0]!.text).toContain("ON CONFLICT (key) DO UPDATE");
    // Reclaiming only expired rows is what makes the single statement safe.
    expect(queries[0]!.text).toContain("expires_at <= now()");
  });

  it("looks up the existing record when the claim is refused", async () => {
    const { client, queries } = spyClient([]);
    const adapter = postgresAdapter({ client });

    const result = await adapter.begin("k", record, 60_000);
    expect(result.acquired).toBe(false);
    expect(queries[1]!.text).toContain("SELECT record");
  });

  it("rejects table and schema names that are not plain identifiers", () => {
    const { client } = spyClient();
    expect(() => postgresAdapter({ client, table: "keys; drop table users" })).toThrow(/Invalid table/);
    expect(() => postgresAdapter({ client, schema: "pub lic" })).toThrow(/Invalid schema/);
  });

  it("refuses to construct without a client", () => {
    // @ts-expect-error deliberately omitting the required client
    expect(() => postgresAdapter({})).toThrow(/requires a client/);
  });

  it("ships a migration that matches the queries it runs", () => {
    const sql = idempotencyTableSql();
    expect(sql).toContain("key         text PRIMARY KEY");
    expect(sql).toContain("record      jsonb NOT NULL");
    expect(sql).toContain("expires_at  timestamptz NOT NULL");
  });
});
