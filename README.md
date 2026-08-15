# next-doc

[![npm](https://img.shields.io/npm/v/next-doc.svg)](https://www.npmjs.com/package/next-doc)
[![CI](https://github.com/hopp/next-doc/actions/workflows/ci.yml/badge.svg)](https://github.com/hopp/next-doc/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/next-doc.svg)](LICENSE)

**One command. Full picture of your Next.js or React app.**

Audits environment variables, security, performance and idempotency, then tells you exactly what to change. No config needed, no account, no telemetry, no network calls.

```bash
npx next-doc
```

```text
NEXT DOC
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
      Suggestion: Wrap the handler with withIdempotency from next-doc/idempotency.

Score: 61/100
4 errors, 3 warnings, 6 passed
```

## Contents

- [Install](#install)
- [What it checks](#what-it-checks)
- [Works with](#works-with)
- [Commands and flags](#commands-and-flags)
- [Exit codes](#exit-codes)
- [Reading the output](#reading-the-output)
- [In CI](#in-ci)
- [The idempotency runtime](#the-idempotency-runtime)
- [Configuration](#configuration)
- [Suppressing a finding](#suppressing-a-finding)
- [Notes worth knowing](#notes-worth-knowing)
- [Full documentation](#full-documentation)

## Install

Nothing to install to try it:

```bash
npx next-doc
```

Add it to the project once you want it in CI:

```bash
npm install --save-dev next-doc
pnpm add -D next-doc
yarn add -D next-doc
```

Requires Node 18.18 or newer.

## What it checks

| Plugin | Finds |
| --- | --- |
| **env** | Secrets exposed to the browser, variables used in code but never defined, drift between `.env` and `.env.example`, wrong value types, credentials committed in a template, dead variables |
| **security** | Missing security headers, no CSP, unverified webhooks, open redirects, cookie mutations with no origin check, server code reachable from the client bundle, hardcoded credentials |
| **performance** | Route JavaScript over budget, `"use client"` with no interactivity, unoptimized images and fonts, server fetches with no caching intent, overlapping dependencies |
| **idempotency** | Payment, checkout and webhook routes with no duplicate request protection, keys read but never persisted |

Plus a runtime library that fixes the last one: [`withIdempotency`](docs/05-idempotency-runtime.md).

## Works with

Next.js (App and Pages Router), React on Vite, Create React App, Remix, React Router framework mode, Astro with React, and plain React.

Rules that only apply to one framework are skipped elsewhere rather than reported as failures. A Vite app is checked for `VITE_` prefix leaks, `import.meta.env` usage and image dimensions, never for `next/image`.

## Commands and flags

```bash
npx next-doc                    # every plugin
npx next-doc env                # one plugin
npx next-doc env security       # several, in one pass
npx next-doc init               # create next-doc.config.json
npx next-doc idempotency --help # list a plugin's rules
```

Plugin names are positional arguments, so they compose: `env security idempotency` reads as one sentence and runs as one pass.

| Flag | What it does |
| --- | --- |
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

Every warning and error carries a file reference where one exists, plus one line saying what to change. A finding with no suggestion is a bug, and a test enforces it.

The score is `100 - (errors × 15) - (warnings × 5)` per plugin, floored at zero, then averaged across the plugins that ran. It is a trend line for your own project, not a league table.

## In CI

```yaml
- run: npm run build          # so bundle sizes are measured, not guessed
- run: npx next-doc --json > next-doc-report.json
- run: npx next-doc --strict
```

The first command always succeeds, so you keep the artifact even on a failing run. The second is the gate.

Full workflow, PR comments, GitLab, and a strategy for adopting this on an existing codebase without drowning in findings: [CI integration](docs/04-ci-integration.md).

## The idempotency runtime

The scan finds handlers that can charge a customer twice. This fixes them:

```ts
import { withIdempotency } from "next-doc/idempotency";
import { redisAdapter } from "next-doc/idempotency/redis";

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
  return idempotency.run(String(formData.get("operationId")), async () => {
    return charge(Number(formData.get("amount")));
  }, { amount: formData.get("amount") });
}
```

Works with Next.js Route Handlers and Server Actions, Remix, React Router, Hono, Cloudflare Workers, Deno and Bun. Zero dependencies, about 2.3kb minified and gzipped, adapters as separate entry points so you only ship the one you import.

Full API, adapters and edge case behaviour: [Idempotency runtime](docs/05-idempotency-runtime.md).

## Configuration

Optional. Run `npx next-doc init` for a starting point.

```json
{
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

Unknown keys are rejected rather than ignored, so a typo cannot leave a check quietly disabled. Every option: [Configuration](docs/02-configuration.md).

## Suppressing a finding

```ts
// next-doc-ignore idempotency
export async function POST(request: Request) {}

// next-doc-ignore IDEM_UNPROTECTED_ROUTE, SECURITY_MISSING_CSRF
export async function PUT(request: Request) {}
```

On the flagged line or the line directly above it. A bare `next-doc-ignore` suppresses everything on that line.

## Notes worth knowing

**Your secrets stay yours.** No network calls anywhere in the tool, and no telemetry. `.env` values are parsed so they can be type checked, and never printed in any output format. A test scans generated reports for known secret values and fails the build if one appears.

**`--fix` cannot touch a real environment file.** It writes to `.env.example` only, with empty placeholders, never a copied or invented value. `.env`, `.env.local`, `.env.production`, `.env.development`, `.env.test` and `.env.staging` are on a hard denylist enforced in one place, with a test asserting it throws even if a rule passes one in deliberately.

**Bundle sizes are measured, never estimated.** With no build output the performance plugin says so and stops, rather than guessing a compiled size from source file size.

**Some rules are heuristics, and say so.** The idempotency scan reports a "possible missing idempotency protection", not a proven one. That is why the ignore comment exists. False positives are treated as bugs, so please report them.

**Warnings do not fail your build by default.** `--strict` is opt in and is expected to stay that way. A tool that fails CI on warnings by default gets uninstalled the first time it blocks an unrelated release.

**Rule codes are a public API.** CI pipelines allowlist them and docs link to them, so renaming one is a breaking change. The same goes for the `--json` schema, which carries a `schemaVersion`.

**Programmatic use.**

```ts
import { runAudit } from "next-doc";

const { report, exitCode } = await runAudit({ cwd: process.cwd(), plugins: ["security"] });
```

## Full documentation

Shipped inside the package, and readable on GitHub:

- [Getting started](docs/01-getting-started.md), install, first run, reading the output
- [Configuration](docs/02-configuration.md), every option in the config file
- Plugins: [env](docs/03-plugins/env.md), [security](docs/03-plugins/security.md), [performance](docs/03-plugins/performance.md), [idempotency](docs/03-plugins/idempotency.md)
- [CI integration](docs/04-ci-integration.md), workflows, exit codes, PR comments
- [Idempotency runtime](docs/05-idempotency-runtime.md), the full `withIdempotency` API
- [JSON schema](docs/06-json-schema.md), the machine readable contract
- [FAQ](docs/07-faq.md)
- [Contributing](docs/08-contributing.md)

## License

MIT, by Hope Murithi.
