<div align="center">

# nextdoc

**One command. Full picture of your Next.js or React app.**

<!-- The scope has to be URL encoded, or shields.io reads the slash as a path
     separator and answers "package not found". -->
[![npm](https://img.shields.io/npm/v/%40wamasoda%2Fnextdoc?color=0c7c88&label=npm)](https://www.npmjs.com/package/@wamasoda/nextdoc)
[![CI](https://github.com/Hopp-Murithi/next-doc/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Hopp-Murithi/next-doc/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/%40wamasoda%2Fnextdoc?color=0c7c88&label=node)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/%40wamasoda%2Fnextdoc?color=0c7c88&label=license)](LICENSE)

[Website](https://next-doc-taupe.vercel.app) · [Documentation](docs/01-getting-started.md) · [Rule reference](#rule-reference) · [Verification](VERIFICATION.md) · [Changelog](CHANGELOG.md)

</div>

---

Audits environment variables, security, performance and idempotency, then tells you exactly what to change. No config needed, no account, no telemetry, no network calls.

```bash
npx @wamasoda/nextdoc
```

```text
NEXTDOC
Next.js 15.1.0  TypeScript  App Router

ENV
  ✓ All 12 referenced variables are defined
  ✗ NEXT_PUBLIC_STRIPE_SECRET_KEY looks like a secret exposed to the client
      src/lib/stripe.ts:3
      Suggestion: Rename it without the NEXT_PUBLIC_ prefix and read it server side only.

SECURITY
  △ 2 security headers are not configured: Permissions-Policy, Strict-Transport-Security
      next.config.mjs
  ✗ Client component app/settings/ProfileForm.tsx pulls in server package "pg" through src/lib/data.ts
      src/lib/data.ts:1
      Suggestion: Move this work into a Server Component and pass the result down as props.

PERFORMANCE
  △ app/dashboard/StaticCard.tsx is a Client Component with no interactivity detected
  ✗ /dashboard ships 487kb of JavaScript, the largest route in the app

IDEMPOTENCY
  ✗ app/api/payments/route.ts has no idempotency key handling detected
      app/api/payments/route.ts:3
      Suggestion: Wrap the handler with withIdempotency from @wamasoda/nextdoc/idempotency.

Score: 61/100
4 errors, 3 warnings, 6 passed
```

## Contents

**Start here**

| Section | What is in it |
| --- | --- |
| [Install](#install) | npx, or add it to the project |
| [What it checks](#what-it-checks) | The four plugins, one line each |
| [Works with](#works-with) | Next.js, Vite, CRA, Remix, React Router, Astro, React |

**Using it**

| Section | What is in it |
| --- | --- |
| [Commands](#commands) | Run everything, or name the plugins you want |
| [Flags](#flags) | Every flag, including `--report` and `--fix` |
| [Exit codes](#exit-codes) | What each code means for your CI step |
| [Reading the output](#reading-the-output) | Icons, the score, and the report file |
| [In CI](#in-ci) | The workflow snippet, and what to gate on |

**Reference**

| Section | What is in it |
| --- | --- |
| [Idempotency runtime](#idempotency-runtime) | `withIdempotency`, adapters, behaviour table |
| [Configuration](#configuration) | The config file and inline suppression |
| [Rule reference](#rule-reference) | All 23 rule codes and their defaults |
| [Notes worth knowing](#notes-worth-knowing) | Secrets, fixes, heuristics, programmatic use |
| [Documentation](#documentation) | The full docs set, page by page |

## Install

Nothing to install to try it:

```bash
npx @wamasoda/nextdoc
```

Add it to the project once you want it in CI:

```bash
npm install --save-dev @wamasoda/nextdoc
pnpm add -D @wamasoda/nextdoc
yarn add -D @wamasoda/nextdoc
```

Requires Node 18.18 or newer.

## What it checks

| Plugin | Finds |
| --- | --- |
| **env** | Secrets exposed to the browser, variables used in code but never defined, drift between `.env` and `.env.example`, wrong value types, credentials committed in a template, dead variables |
| **security** | Missing security headers, no CSP, unverified webhooks, open redirects, cookie mutations with no origin check, server code reachable from the client bundle, hardcoded credentials |
| **performance** | Route JavaScript over budget, `"use client"` with no interactivity, unoptimized images and fonts, server fetches with no caching intent, overlapping dependencies |
| **idempotency** | Payment, checkout and webhook routes with no duplicate request protection, keys read but never persisted |

23 rules in total. The fourth plugin also ships the runtime library that fixes what it finds: [`withIdempotency`](#idempotency-runtime).

## Works with

| Project | Detected by | Notes |
| --- | --- | --- |
| Next.js, App or Pages Router | `next.config.*`, `next` dependency | Every rule runs |
| React on Vite | `vite.config.*` plus `react` | `VITE_` prefixes, `import.meta.env` |
| Create React App | `react-scripts` | `REACT_APP_` prefixes |
| Remix | `remix.config.*` | Server rules run |
| React Router framework mode | `react-router.config.*` | Server rules run |
| Astro with React | `astro.config.*` | `PUBLIC_` prefixes |
| Plain React | `react` dependency | Client side rules only |

Rules that only apply to one framework are skipped elsewhere rather than reported as failures. A Vite app is checked for `VITE_` prefix leaks and image dimensions, never for `next/image`.

## Commands

```bash
npx @wamasoda/nextdoc                    # every plugin
npx @wamasoda/nextdoc env                # one plugin
npx @wamasoda/nextdoc env security       # several, in one pass
npx @wamasoda/nextdoc init               # create nextdoc.config.json
npx @wamasoda/nextdoc idempotency --help # list a plugin's rules
```

Plugin names are positional arguments, so they compose. `env security idempotency` reads as one sentence and runs as one pass.

## Flags

| Flag | What it does |
| --- | --- |
| `--report [path]` | Write the full report to a markdown file, default `nextdoc-report.md` |
| `--full` | Print every finding in the terminal, however many there are |
| `--no-report` | Never write a file, print everything instead |
| `--fix` | Applies the automatic fixes that cannot be wrong |
| `--json` | Machine readable output with a versioned schema |
| `--markdown` | Markdown report, made for a pull request comment |
| `--score` | Prints the score and nothing else |
| `--strict` | Warnings fail the run too |
| `--config <path>` | Use a specific config file |
| `--ignore <glob...>` | Extra glob patterns to exclude |
| `--cwd <path>` | Scan a different directory |
| `--no-color` | Plain output, also applied automatically outside a TTY |
| `-v, --version` | Print the version |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No errors, or warnings only without `--strict` |
| `1` | One or more errors found, or warnings with `--strict` |
| `2` | Config file invalid, or missing when passed with `--config` |
| `3` | Not a Next.js or React project |
| `4` | Internal error, with a message asking for an issue and the `--json` output |

## Reading the output

- `✓` **pass**, the check ran and found nothing.
- `△` **warning**, worth fixing, does not fail the run unless you pass `--strict`.
- `✗` **error**, fails the run with exit code 1.

Every warning and error carries a file reference where one exists, plus one line saying what to change. A finding with no suggestion is a bug, and a test enforces it. Icons fall back to plain ASCII outside a TTY, so CI logs stay readable.

**On a large codebase the terminal stays short.** Past 30 findings, nextdoc prints a summary and writes the detail to `nextdoc-report.md` in the folder you ran it from:

```text
NEXTDOC
Next.js 15.5.7  TypeScript  App + Pages Router

  ✗ 32 errors   △ 368 warnings   ✓ 6 passed   Score 24/100

  ENV            3 errors, 26 warnings
  SECURITY       11 errors, 1 warning
  PERFORMANCE    11 errors, 336 warnings
  IDEMPOTENCY    7 errors, 5 warnings

  Most common
      115  PERF_UNCACHED_FETCH
      112  PERF_UNNECESSARY_USE_CLIENT
      108  PERF_UNOPTIMIZED_IMAGE

  Worst files
        9  src/app/api/checkout/route.ts
        6  src/components/Feed.tsx

  Full report: nextdoc-report.md
  Run nextdoc --full to print everything here instead.
```

The file groups findings by plugin, then by rule code, with one suggestion per rule rather than one per occurrence. Use `--report path/to/file.md` to choose where it goes, `--full` to print everything to the terminal, or `--no-report` to never write a file.

The score is `100 - (errors × 15) - (warnings × 5)` per plugin, floored at zero, then averaged across the plugins that ran. It is a trend line for your own project, not a league table.

## In CI

```yaml
- run: npm run build          # so bundle sizes are measured, not guessed
- run: npx @wamasoda/nextdoc --json > nextdoc-report.json
- run: npx @wamasoda/nextdoc --strict
```

The first command always succeeds, so you keep the artifact even on a failing run. The second is the gate.

Full workflow, PR comments, GitLab, and a strategy for adopting this on an existing codebase without drowning in findings: [CI integration](docs/04-ci-integration.md).

## Idempotency runtime

The scan finds handlers that can charge a customer twice. This fixes them:

```ts
import { withIdempotency } from "@wamasoda/nextdoc/idempotency";
import { redisAdapter } from "@wamasoda/nextdoc/idempotency/redis";

export const POST = withIdempotency(
  async (request: Request) => {
    const { amount } = await request.json();
    const charge = await stripe.paymentIntents.create({ amount, currency: "usd" });
    return Response.json({ id: charge.id });
  },
  { adapter: redisAdapter({ client: redis }), ttlSeconds: 86400 },
);
```

| Situation | Response |
| --- | --- |
| Retry with the same `Idempotency-Key` | The stored response, verbatim, plus `Idempotent-Replay: true` |
| The first request is still in flight | `409`, never a queue and never an open ended wait |
| Key reused with a different body | `422`, rather than someone else's result |
| Storage unreachable | `503`, fails closed by default |
| Handler threw | The key is released, so a retry actually retries |

Server Actions have no `Request`, so they use the runner form:

```ts
const idempotency = createIdempotency({ adapter: redisAdapter({ client: redis }) });

export async function checkout(formData: FormData) {
  const amount = Number(formData.get("amount"));
  return idempotency.run(String(formData.get("operationId")), () => charge(amount), { amount });
}
```

Works with Next.js Route Handlers and Server Actions, Remix, React Router, Hono, Cloudflare Workers, Deno and Bun. Zero dependencies, 2.25kb minified and gzipped, adapters as separate entry points so you only ship the one you import.

| Adapter | Import | Use for |
| --- | --- | --- |
| Memory | `@wamasoda/nextdoc/idempotency/memory` | Development and tests. One process only |
| Redis | `@wamasoda/nextdoc/idempotency/redis` | Production. ioredis, node-redis v4 or `@upstash/redis` |
| Postgres | `@wamasoda/nextdoc/idempotency/postgres` | Production. Any node-postgres style client |

Full API, edge cases and the adapter contract: [Idempotency runtime](docs/05-idempotency-runtime.md).

## Configuration

Optional. Run `npx @wamasoda/nextdoc init` for a starting point.

```json
{
  "$schema": "https://unpkg.com/@wamasoda/nextdoc/schema.json",
  "plugins": ["env", "security", "performance", "idempotency"],
  "ignore": ["**/generated/**"],
  "strict": false,
  "rules": {
    "ENV_UNUSED_VAR": "off",
    "PERF_UNOPTIMIZED_IMAGE": "warn",
    "IDEM_UNPROTECTED_ROUTE": "error"
  },
  "env": {
    "required": ["DATABASE_URL"],
    "types": { "DATABASE_URL": "url", "PORT": "number" },
    "allowPublic": ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"]
  },
  "performance": { "maxRouteKb": 200 },
  "idempotency": { "pathPatterns": ["payment", "checkout", "webhook", "ledger"] }
}
```

Unknown keys are rejected rather than ignored, so a typo cannot leave a check quietly disabled. The `$schema` line gives you autocomplete and inline validation in any editor. Every option: [Configuration](docs/02-configuration.md).

Suppress a single finding on the flagged line or the line above it:

```ts
// nextdoc-ignore idempotency
export async function POST(request: Request) {}

// nextdoc-ignore IDEM_UNPROTECTED_ROUTE, SECURITY_MISSING_CSRF
export async function PUT(request: Request) {}
```

## Rule reference

Rule codes are a public API. CI pipelines allowlist them and documentation links to them, so renaming one is a breaking change.

### env

| Code | Default | Checks |
| --- | --- | --- |
| `ENV_MISSING_REQUIRED` | error | A variable listed in `env.required` is defined nowhere |
| `ENV_MISSING_VAR` | warning | Code reads a variable no environment file defines |
| `ENV_PUBLIC_SECRET` | error | A browser exposed variable named like a credential |
| `ENV_SECRET_IN_EXAMPLE` | error | A real looking credential committed in `.env.example` |
| `ENV_TYPE_MISMATCH` | warning | A value does not match its declared type |
| `ENV_FILE_DRIFT` | warning, fixable | A key is in `.env` but missing from `.env.example` |
| `ENV_EXAMPLE_MISSING` | warning, fixable | There is no `.env.example` at all |
| `ENV_UNUSED_VAR` | warning | A variable is defined but never read |

### security

| Code | Default | Checks |
| --- | --- | --- |
| `SECURITY_MISSING_HEADER` | warning, sometimes fixable | Configured security headers are not set anywhere |
| `SECURITY_NO_CSP` | warning | No Content Security Policy found |
| `SECURITY_WEAK_CSP` | warning | The policy allows `unsafe-inline` or `unsafe-eval` |
| `SECURITY_PUBLIC_SECRET` | error | Same check as `ENV_PUBLIC_SECRET`, run here too |
| `SECURITY_HARDCODED_SECRET` | error | A vendor credential format pasted into source |
| `SECURITY_SERVER_CODE_IN_CLIENT` | error | A server package reachable from the client bundle |
| `SECURITY_WEBHOOK_UNVERIFIED` | error | A webhook handler with no signature verification |
| `SECURITY_MISSING_CSRF` | warning | A cookie authenticated mutation with no origin check |
| `SECURITY_UNSAFE_REDIRECT` | error | A redirect target taken from the request unvalidated |

### performance

| Code | Default | Checks |
| --- | --- | --- |
| `PERF_LARGE_ROUTE` | error | A route ships more JavaScript than the budget |
| `PERF_NO_BUILD_OUTPUT` | warning | No build output, so nothing was measured |
| `PERF_UNNECESSARY_USE_CLIENT` | warning | A Client Component with no browser only feature |
| `PERF_UNCACHED_FETCH` | warning | A server fetch with no caching intent declared |
| `PERF_UNOPTIMIZED_IMAGE` | warning | A raw `img`, or one with no dimensions |
| `PERF_FONT_LOADING` | warning | A render blocking webfont |
| `PERF_DUPLICATE_DEPS` | warning | Two dependencies doing the same job |

### idempotency

| Code | Default | Checks |
| --- | --- | --- |
| `IDEM_UNPROTECTED_ROUTE` | error | A money handling mutation with no idempotency handling |
| `IDEM_KEY_NOT_PERSISTED` | warning | A key is read but never stored, so nothing is deduplicated |

## Notes worth knowing

**Your secrets stay yours.** No network calls anywhere in the tool, and no telemetry. `.env` values are parsed so they can be type checked, and never printed in any output format. A test scans generated reports for known secret values and fails the build if one appears.

**`--fix` cannot touch a real environment file.** It writes to `.env.example` only, with empty placeholders, never a copied or invented value. `.env`, `.env.local`, `.env.production`, `.env.development`, `.env.test` and `.env.staging` are on a hard denylist enforced in one place, with a test asserting it throws even if a rule passes one in deliberately.

**Bundle sizes are measured, never estimated.** With no build output the performance plugin says so and stops, rather than guessing a compiled size from source file size.

**Some rules are heuristics, and say so.** The idempotency scan reports a "possible missing idempotency protection", not a proven one. That is what the ignore comment is for. False positives are treated as bugs, so please report them.

**Warnings do not fail your build by default.** `--strict` is opt in and is expected to stay that way. A tool that fails CI on warnings by default gets uninstalled the first time it blocks an unrelated release.

**Programmatic use.**

```ts
import { runAudit } from "@wamasoda/nextdoc";

const { report, exitCode } = await runAudit({ cwd: process.cwd(), plugins: ["security"] });
```

The report types are exported too: `RunReport`, `PluginResult`, `Finding`.

## Documentation

Shipped inside the package, and readable on GitHub:

| Page | Covers |
| --- | --- |
| [Getting started](docs/01-getting-started.md) | Install, first run, reading the output |
| [Configuration](docs/02-configuration.md) | Every option in the config file |
| [env](docs/03-plugins/env.md) | Every env rule, with passing and failing examples |
| [security](docs/03-plugins/security.md) | Every security rule, and what each one prevents |
| [performance](docs/03-plugins/performance.md) | Every performance rule and where the numbers come from |
| [idempotency](docs/03-plugins/idempotency.md) | The static scan, and how to tune it |
| [CI integration](docs/04-ci-integration.md) | Workflows, exit codes, PR comments, adoption |
| [Idempotency runtime](docs/05-idempotency-runtime.md) | The full `withIdempotency` API |
| [JSON schema](docs/06-json-schema.md) | The machine readable contract |
| [FAQ](docs/07-faq.md) | The questions people actually ask |
| [Contributing](docs/08-contributing.md) | Adding a rule, testing it, releasing |

## License

MIT, by [wamasoda](https://github.com/Hopp-Murithi).
