# Getting started

next-doc is a single command that audits a Next.js or React project across four areas: environment variables, security, performance, and idempotency. It reads your source, your config and your `.env` files, and prints a report. Nothing is uploaded anywhere.

## Install

You do not have to install anything to try it:

```bash
npx @wamasoda/next-doc
```

Add it to the project once you want it in CI:

```bash
npm install --save-dev @wamasoda/next-doc
pnpm add -D @wamasoda/next-doc
yarn add -D @wamasoda/next-doc
```

Requires Node 18.18 or newer.

## Supported projects

| Project | Detected by | Notes |
| --- | --- | --- |
| Next.js, App Router | `next.config.*`, `next` dependency | Every rule runs |
| Next.js, Pages Router | same | Every rule runs |
| React on Vite | `vite.config.*` plus `react` | `VITE_` prefixes, `import.meta.env` |
| Create React App | `react-scripts` | `REACT_APP_` prefixes |
| Remix, React Router framework mode | `remix.config.*`, `react-router.config.*` | Server rules run |
| Astro with React | `astro.config.*` | `PUBLIC_` prefixes |
| Plain React | `react` dependency | Client side rules only |

Rules that only make sense on one framework are skipped elsewhere rather than reported as failures. `next/image` is never suggested for a Vite app; that app gets a width, height and lazy loading check instead.

## First run

```bash
npx @wamasoda/next-doc
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
      Suggestion: Add them to the existing headers() block in next.config.mjs.
  ✗ app/api/webhooks/stripe/route.ts handles webhooks with no signature verification detected
      app/api/webhooks/stripe/route.ts:1
      Suggestion: Verify the provider signature before trusting the payload.

PERFORMANCE
  △ 7 Client Components with no interactivity detected
  ✗ /dashboard ships 487kb of JavaScript, the largest route in the app

IDEMPOTENCY
  ✗ app/api/payments/route.ts has no idempotency key handling detected

Score: 61/100
4 errors, 3 warnings, 6 passed
```

## Reading the output

Three states, each with an icon, a colour, and a plain ASCII fallback for CI logs:

- `✓` **pass**, the check ran and found nothing.
- `△` **warning**, worth fixing, does not fail the run unless you pass `--strict`.
- `✗` **error**, fails the run with exit code 1.

Every warning and every error carries a file reference when one exists, plus a one line suggestion. A finding without a suggestion is a bug, and there is a test that enforces it.

The score is `100 - (errors × 15) - (warnings × 5)` per plugin, floored at zero, then averaged across the plugins that ran. It is a trend line for your own project, not a comparison against anyone else's.

## Running one plugin at a time

Plugin names are positional arguments, so they compose:

```bash
npx @wamasoda/next-doc env
npx @wamasoda/next-doc env security
npx @wamasoda/next-doc idempotency --help   # lists that plugin's rules
```

## Fixing things

```bash
npx @wamasoda/next-doc --fix
```

`--fix` only applies changes that cannot be wrong:

- writes missing keys into `.env.example` as empty placeholders
- scaffolds a `next.config.mjs` security headers block when no config file exists

It never writes to `.env`, `.env.local`, `.env.production` or any other real environment file. That restriction lives in one place in the code and has its own test. The performance plugin has no fixes at all, because removing a `"use client"` directive incorrectly breaks the app at runtime.

## Next steps

- [Configuration](02-configuration.md), every option in `next-doc.config.json`
- [Plugins](03-plugins/env.md), what each rule checks and why
- [CI integration](04-ci-integration.md), exit codes, JSON output, PR comments
- [Idempotency runtime](05-idempotency-runtime.md), the `withIdempotency` wrapper
