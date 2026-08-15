import type { BeginResult, IdempotencyAdapter, IdempotencyRecord } from "../types.js";

/**
 * Minimal shape of a Redis client. Deliberately structural so this file has no
 * dependency of its own: pass whichever client you already have.
 *
 * Supported out of the box: ioredis, node-redis v4, @upstash/redis.
 */
export interface RedisLikeClient {
  set?: (...args: unknown[]) => Promise<unknown>;
  get?: (key: string) => Promise<unknown>;
  del?: (key: string) => Promise<unknown>;
  /** ioredis */
  call?: (...args: unknown[]) => Promise<unknown>;
  /** node-redis v4 */
  sendCommand?: (args: string[]) => Promise<unknown>;
}

export interface RedisAdapterOptions {
  client?: RedisLikeClient;
  /** Connection string. Loads ioredis dynamically, which must then be installed. */
  url?: string;
  /** Key namespace. Default "idem:". */
  prefix?: string;
}

async function loadIoredis(url: string): Promise<RedisLikeClient> {
  try {
    // Indirect specifier: keeps ioredis out of the module graph so bundlers do
    // not try to resolve it in projects that never use this adapter.
    const specifier = "ioredis";
    const mod = (await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier)) as {
      default: new (url: string) => RedisLikeClient;
    };
    return new mod.default(url);
  } catch {
    // Fail here, at startup, rather than at the first payment request.
    throw new Error(
      "redisAdapter({ url }) needs ioredis installed. Run: npm install ioredis. Or pass an existing client with redisAdapter({ client }).",
    );
  }
}

function parseRecord(raw: unknown): IdempotencyRecord | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") return raw as IdempotencyRecord;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as IdempotencyRecord;
  } catch {
    return null;
  }
}

/**
 * Redis backed storage. The claim is a single SET NX PX, so two requests
 * arriving in the same millisecond cannot both win it, including across
 * multiple server instances.
 */
export function redisAdapter(options: RedisAdapterOptions = {}): IdempotencyAdapter {
  const prefix = options.prefix ?? "idem:";
  let clientPromise: Promise<RedisLikeClient> | null = options.client
    ? Promise.resolve(options.client)
    : null;

  if (!clientPromise && !options.url) {
    throw new Error("redisAdapter requires either a client or a url.");
  }

  const getClient = (): Promise<RedisLikeClient> => {
    clientPromise ??= loadIoredis(options.url!);
    return clientPromise;
  };

  const k = (key: string) => `${prefix}${key}`;

  async function setNx(client: RedisLikeClient, key: string, value: string, ttlMs: number): Promise<boolean> {
    if (typeof client.sendCommand === "function") {
      const result = await client.sendCommand(["SET", key, value, "PX", String(ttlMs), "NX"]);
      return result === "OK" || result === true;
    }
    if (typeof client.call === "function") {
      const result = await client.call("SET", key, value, "PX", String(ttlMs), "NX");
      return result === "OK";
    }
    if (typeof client.set === "function") {
      const result = await client.set(key, value, { nx: true, px: ttlMs });
      return result === "OK" || result === true;
    }
    throw new Error("Unsupported Redis client: expected set, call or sendCommand.");
  }

  async function setValue(client: RedisLikeClient, key: string, value: string, ttlMs: number): Promise<void> {
    if (typeof client.sendCommand === "function") {
      await client.sendCommand(["SET", key, value, "PX", String(ttlMs)]);
      return;
    }
    if (typeof client.call === "function") {
      await client.call("SET", key, value, "PX", String(ttlMs));
      return;
    }
    if (typeof client.set === "function") {
      await client.set(key, value, { px: ttlMs });
      return;
    }
    throw new Error("Unsupported Redis client: expected set, call or sendCommand.");
  }

  return {
    name: "redis",

    async begin(key: string, record: IdempotencyRecord, ttlMs: number): Promise<BeginResult> {
      const client = await getClient();
      const acquired = await setNx(client, k(key), JSON.stringify(record), ttlMs);
      if (acquired) return { acquired: true };
      const existing = parseRecord(await client.get?.(k(key)));
      return { acquired: false, existing };
    },

    async complete(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void> {
      const client = await getClient();
      await setValue(client, k(key), JSON.stringify(record), ttlMs);
    },

    async release(key: string): Promise<void> {
      const client = await getClient();
      await client.del?.(k(key));
    },

    async get(key: string): Promise<IdempotencyRecord | null> {
      const client = await getClient();
      return parseRecord(await client.get?.(k(key)));
    },
  };
}
