# security plugin

```bash
npx @wamasoda/next-doc security
```

## What it checks

Response headers, credential exposure, webhook authenticity, cookie authenticated mutations, redirect targets, and whether server only code can reach the browser bundle.

## Why it matters

These are the mistakes that do not announce themselves. An unverified webhook endpoint works perfectly in testing and accepts forged events in production. A database client imported three files below a Client Component compiles into the JavaScript bundle along with whatever credential it reads. None of it breaks a build, and none of it shows up in a code review diff unless someone happens to trace the import chain by hand.

## Rules

### `SECURITY_MISSING_HEADER` (warning, sometimes fixable)

One or more of the configured headers is not set anywhere. Default set: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`.

Searched: `next.config.*`, `middleware.*`, `vercel.json`, `netlify.toml`, `public/_headers`, `staticwebapp.config.json`, `app/entry.server.*`, `server.*`, `nginx.conf`, plus anything in `security.headerFiles`.

Reported as one finding listing every missing header, because it is one edit either way.

`--fix` scaffolds a complete `next.config.mjs` headers block, but only for a Next.js project that has no `next.config.*` file at all. When a config already exists, the suggestion is printed and nothing is written: merging into an existing `headers()` function safely is higher risk than it is worth.

### `SECURITY_NO_CSP` (warning)

No `Content-Security-Policy` anywhere in the header sources. v1 checks presence only. It deliberately does not grade a policy, because grading one properly means resolving every script and style source in the app.

### `SECURITY_WEAK_CSP` (warning)

A CSP exists but contains `'unsafe-inline'` or `'unsafe-eval'`, which removes most of its value.

### `SECURITY_PUBLIC_SECRET` (error)

Same check as `ENV_PUBLIC_SECRET`, run here too so `next-doc security` is complete on its own. See [env](env.md#env_public_secret-error).

### `SECURITY_HARDCODED_SECRET` (error, warning in test files)

A credential pasted into source. Matches vendor formats only, so it does not fire on every long string: Stripe `sk_`/`rk_`, AWS `AKIA`, GitHub `ghp_`, OpenAI `sk-`, Anthropic `sk-ant-`, Slack `xox`, Google `AIza`, private key blocks, JWTs, and database URLs containing a password.

Findings in `test/`, `__tests__/`, `e2e/`, `cypress/` and `fixtures/` are warnings, since fake values live there legitimately. The value is never printed.

### `SECURITY_SERVER_CODE_IN_CLIENT` (error)

Server only code reachable from the browser bundle. The rule walks the local import graph rather than pattern matching a single file, because the leak is rarely a direct import:

```text
app/settings/ProfileForm.tsx ("use client")
  -> src/lib/data.ts
       -> pg
```

Flagged specifiers: Node builtins (`fs`, `child_process`, `net`, `dns`, `tls`, `http`, `os` and similar), the `server-only` package, and server SDKs such as `pg`, `mysql2`, `mongodb`, `@prisma/client`, `ioredis`, `nodemailer`, `bcrypt`, `jsonwebtoken`, `firebase-admin`, `stripe`, `resend` and `googleapis`.

On Next.js the entry points are files carrying a `"use client"` directive. On a client rendered React app every module under the source directories is a client entry point, because all of it ships to the browser; config files, `server/`, `api/`, `scripts/` and `*.server.*` files are excluded.

Resolution handles relative paths, extensionless imports, directory index files, and `@/...` and `~/...` aliases. Anything it cannot resolve is not followed, which keeps the rule conservative rather than wrong.

### `SECURITY_WEBHOOK_UNVERIFIED` (error)

A file on a webhook path with no signature verification detected. Accepted evidence includes `stripe.webhooks.constructEvent`, `constructEventAsync`, `crypto.createHmac`, `crypto.timingSafeEqual`, Svix `new Webhook(...)` or `verifyHeader`, `subtle.verify`, and reads of a known signature header (`stripe-signature`, `x-hub-signature`, `svix-signature`, `x-shopify-hmac`, `x-paddle-signature`, `paypal-transmission-sig`).

Without verification, anyone who learns the URL can post whatever events they like.

### `SECURITY_MISSING_CSRF` (warning)

A non-GET Route Handler or Server Action that reads cookies but never checks the request origin or a CSRF token. Evidence that silences it: any reference to `origin`, `referer`, `sec-fetch-site`, `csrf`, an `authorization` or bearer header, or a session helper such as `auth()`, `getServerSession` or `getToken`.

Only runs on frameworks with a server runtime.

### `SECURITY_UNSAFE_REDIRECT` (error)

A redirect whose target comes from the request: `searchParams`, `params`, `request.url`, `formData.get`, or a parameter named `next`, `callbackUrl`, `returnTo` or `redirect_uri`. Silenced by nearby validation such as a `startsWith("/")` check, an origin comparison, or an allowlist.

Covers `redirect()`, `NextResponse.redirect()`, `Response.redirect()` and `location.href`/`replace`/`assign`.

## What `--fix` does

Only `SECURITY_MISSING_HEADER`, and only when there is no Next.js config file to merge into. Everything else prints a suggestion.

## Suppressing a finding

```ts
// next-doc-ignore SECURITY_MISSING_CSRF
export async function POST(request: Request) {}
```
