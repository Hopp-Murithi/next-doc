import type { BeginResult, IdempotencyAdapter, IdempotencyRecord } from "../types.js";

interface Entry {
  record: IdempotencyRecord;
  expiresAt: number;
}

export interface MemoryAdapterOptions {
  /** Cap on stored keys. The oldest entries are dropped past this. Default 10000. */
  maxEntries?: number;
}

/**
 * In process storage for development and tests.
 *
 * Atomic within one process because JavaScript runs the claim without an await
 * in the middle, which is exactly the property the contract requires. It is
 * still per process: two server instances do not share it, so it is not a
 * production backend. Use the Redis or Postgres adapter there.
 */
export function memoryAdapter(options: MemoryAdapterOptions = {}): IdempotencyAdapter {
  const store = new Map<string, Entry>();
  const maxEntries = options.maxEntries ?? 10_000;

  const live = (key: string): Entry | null => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry;
  };

  return {
    name: "memory",

    async begin(key: string, record: IdempotencyRecord, ttlMs: number): Promise<BeginResult> {
      const existing = live(key);
      if (existing) return { acquired: false, existing: existing.record };

      if (store.size >= maxEntries) {
        const oldest = store.keys().next();
        if (!oldest.done) store.delete(oldest.value);
      }
      store.set(key, { record, expiresAt: Date.now() + ttlMs });
      return { acquired: true };
    },

    async complete(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void> {
      store.set(key, { record, expiresAt: Date.now() + ttlMs });
    },

    async release(key: string): Promise<void> {
      store.delete(key);
    },

    async get(key: string): Promise<IdempotencyRecord | null> {
      return live(key)?.record ?? null;
    },

    async close(): Promise<void> {
      store.clear();
    },
  };
}
