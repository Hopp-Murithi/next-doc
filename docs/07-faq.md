# FAQ

## Does it send my code or my secrets anywhere?

No. There is no network call anywhere in the tool, and no telemetry of any kind. It reads files, prints a report, exits.

If telemetry is ever added it will be opt in, documented in the README before you install, and will never include `.env` contents, file contents, or file paths.

## It reads my `.env` files. What does it do with the values?

It parses them so it can type check them and recognise a credential shape, and that is all. Values never reach the report in any format, terminal, JSON or markdown. Findings reference variable names and expected shapes only.

There is a test that scans the generated reports of every fixture project for known secret values and fails the build if one appears.

## Can `--fix` damage my environment files?

It cannot write to them at all. `.env`, `.env.local`, `.env.production`, `.env.development`, `.env.test` and `.env.staging` are on a hard denylist enforced in one place in the code, with a test asserting the fixer throws even if a rule passes one of those paths in deliberately. The only file it writes is `.env.example`, and only ever key names with empty placeholders.

## Does it work on a plain React app, or only Next.js?

Both. It detects Next.js, Vite, Create React App, Remix, React Router framework mode, Astro with React, and plain React projects, then runs the rules that apply. A Vite app gets `VITE_` prefix checks, `import.meta.env` scanning, an `index.html` font check, and image dimension checks. Next.js only rules such as `next/image`, `"use client"` boundaries and fetch caching are skipped rather than reported as failures.

## Why does the performance plugin say it could not measure my bundle?

Because there is no build output to measure. Run `next build` (or your production build) first, then run the plugin again.

nextdoc will not estimate a compiled bundle size from source file size. An invented number that disagrees with your own build output would cost more trust than the check is worth.

## Why is a finding worded as "possible"?

Because the rule is a heuristic and cannot prove the problem. The idempotency scan is the clearest case: it can see that a payment route never mentions an idempotency key, but it cannot know that a wrapper three layers down handles it. Suppress a wrong one:

```ts
// nextdoc-ignore idempotency
export async function POST(request: Request) {}
```

## Why does it flag my client component for importing `stripe`?

The `stripe` package is the server SDK. Anything reachable from a `"use client"` file is compiled into the browser bundle, along with any credential that module reads at import time. The browser side package is `@stripe/stripe-js`, which is not flagged.

## Can I turn a rule off?

Yes, per rule, by its code:

```json
{ "rules": { "ENV_UNUSED_VAR": "off", "PERF_UNOPTIMIZED_IMAGE": "warn" } }
```

## Should `--strict` be the default?

No, and there are no plans to change that. A tool that fails CI on warnings by default gets uninstalled the first time it blocks an unrelated release. Turn it on for the pipeline you actually want gated.

## What does the score mean?

`100 - (errors × 15) - (warnings × 5)` per plugin, floored at zero, averaged across the plugins that ran. It is a trend line for your own project over time. Comparing it against another project's score means very little, since a project with more surface area has more to find.

## Does it replace ESLint?

No. ESLint checks code patterns. This checks project shape: config files, environment files, build output, response headers, and the client server boundary. They overlap almost nowhere.

## Does the runtime idempotency wrapper bloat my bundle?

The core wrapper is about 2.3kb minified and gzipped, with zero dependencies, and CI fails if it grows past 3kb. Adapters are separate entry points, so you only ship the one you import. The CLI, commander, the glob code and the AST work are in a different entry point and cannot reach an app bundle.

## Which Redis client does the adapter need?

Whichever one you already have. `redisAdapter({ client })` accepts ioredis, node-redis v4 and `@upstash/redis`, detected by shape. `redisAdapter({ url })` loads ioredis dynamically and fails at startup with a clear message if it is not installed, rather than at the first payment request.

## Why 409 instead of waiting for the in flight request?

Waiting holds a connection for an unbounded time and turns one slow payment into a queue of stuck requests. A 409 tells the client precisely what to do: retry in a moment with the same key.

## Can I use the scanner programmatically?

Yes:

```ts
import { runAudit } from "@wamasoda/nextdoc";

const { report, exitCode } = await runAudit({ cwd: process.cwd(), plugins: ["security"] });
```

## Windows?

Supported and tested. CI runs the full suite on Windows, macOS and Linux across Node 18, 20 and 22. Report paths always use forward slashes so reports compare cleanly across a mixed team.

## How do I report a false positive?

Open an issue with the rule code, a minimal snippet that triggers it, and the `--json` output. False positives on heuristic rules are treated as bugs, because a heuristic people stop trusting is worse than no rule at all.
