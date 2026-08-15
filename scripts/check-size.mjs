#!/usr/bin/env node
/**
 * Bundle budget for the runtime subpath.
 *
 * This code is imported into application Server Actions and Route Handlers, so
 * it ends up in a production build. The CLI is a dev dependency and is exempt,
 * but this entry point is treated like any public library: it has a budget, and
 * exceeding it fails the build rather than being noticed six releases later.
 */
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const BUDGETS = [
  { entry: "src/runtime/idempotency.ts", label: "idempotency core", maxGzipKb: 3 },
  { entry: "src/runtime/adapters/memory.ts", label: "memory adapter", maxGzipKb: 1 },
  { entry: "src/runtime/adapters/redis.ts", label: "redis adapter", maxGzipKb: 1.5 },
  { entry: "src/runtime/adapters/postgres.ts", label: "postgres adapter", maxGzipKb: 1.5 },
];

let failed = false;

for (const budget of BUDGETS) {
  const result = await build({
    entryPoints: [budget.entry],
    bundle: true,
    minify: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    write: false,
    treeShaking: true,
  });

  const code = result.outputFiles[0].contents;
  const gzipKb = gzipSync(code).length / 1024;
  const minKb = code.length / 1024;
  const ok = gzipKb <= budget.maxGzipKb;
  if (!ok) failed = true;

  console.log(
    `${ok ? "ok  " : "FAIL"}  ${budget.label.padEnd(18)} ${minKb.toFixed(2)}kb min, ${gzipKb.toFixed(2)}kb gzip  (budget ${budget.maxGzipKb}kb)`,
  );
}

// The CLI has no size budget, but a dependency count creeping upward is the
// early warning for both install time and supply chain surface.
const pkg = JSON.parse(await import("node:fs").then((fs) => fs.promises.readFile("package.json", "utf8")));
const deps = Object.keys(pkg.dependencies ?? {});
const MAX_DEPS = 10;
const depsOk = deps.length <= MAX_DEPS;
if (!depsOk) failed = true;
console.log(`${depsOk ? "ok  " : "FAIL"}  direct dependencies  ${deps.length} of ${MAX_DEPS} allowed: ${deps.join(", ")}`);

if (failed) {
  console.error("\nSize check failed.");
  process.exit(1);
}
