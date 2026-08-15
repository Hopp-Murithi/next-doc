import type { NextDocPlugin } from "../../core/types.js";
import { unprotectedMutationRoute, keyReadButNotStored } from "./rules/unprotected-mutation-route.js";

/**
 * The static half of idempotency. The runtime half, the wrapper that actually
 * fixes what this finds, ships as @wamasoda/nextdoc/idempotency and is
 * documented in docs/05-idempotency-runtime.md.
 */
export const idempotencyPlugin: NextDocPlugin = {
  name: "idempotency",
  description: "Finds payment, webhook and checkout mutations with no duplicate request protection",
  rules: [unprotectedMutationRoute, keyReadButNotStored],
};
