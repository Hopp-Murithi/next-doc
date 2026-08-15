import { defineConfig } from "tsup";

export default defineConfig([
  {
    // CLI binary.
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    target: "node18",
    platform: "node",
    dts: false,
    // Never clean. Builds overwrite in place, so a second build starting while
    // the CLI tests are spawning dist/cli.js cannot delete the file underneath
    // them. Use `npm run clean` when you actually want an empty dist.
    clean: false,
    // No sourcemap: this is a dev dependency people run, not code they debug,
    // and the map is larger than the bundle it describes.
    sourcemap: false,
    splitting: false,
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    // Programmatic API for the scanner (used by CI wrappers and tests).
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    target: "node18",
    platform: "node",
    dts: true,
    clean: false,
    sourcemap: false,
    splitting: false,
  },
  {
    // Runtime subpath. Sourcemaps stay on here: this code ends up in an
    // application bundle, where a readable stack trace is worth the bytes. Zero dependencies, tree shakeable, safe to bundle into an app.
    entry: {
      idempotency: "src/runtime/idempotency.ts",
      "idempotency-memory": "src/runtime/adapters/memory.ts",
      "idempotency-redis": "src/runtime/adapters/redis.ts",
      "idempotency-postgres": "src/runtime/adapters/postgres.ts",
    },
    format: ["esm", "cjs"],
    target: "es2022",
    platform: "neutral",
    dts: true,
    clean: false,
    sourcemap: true,
    splitting: false,
    treeshake: true,
  },
]);
