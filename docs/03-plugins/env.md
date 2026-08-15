# env plugin

```bash
npx next-doc env
```

## What it checks

Whether the variables your code reads, the variables your `.env` files define, and the variables your template documents actually agree with each other, and whether any of them leak to the browser.

## Why it matters

Environment drift is quiet. Nothing fails at build time when a variable is missing from `.env.example`, it fails on a new laptop three weeks later. And a credential with a public prefix is not hidden anywhere: the framework inlines that value into the JavaScript every visitor downloads. Both problems are invisible in code review and obvious to a scanner.

## Public prefixes per framework

The plugin uses the right prefix for the project it finds:

| Framework | Browser exposed prefix | Read as |
| --- | --- | --- |
| Next.js | `NEXT_PUBLIC_` | `process.env.X` |
| Vite | `VITE_` | `import.meta.env.X` |
| Create React App | `REACT_APP_` | `process.env.X` |
| Astro | `PUBLIC_`, `VITE_` | `import.meta.env.X` |
| Remix, React Router on Vite | `VITE_` | `import.meta.env.X` |

## Rules

### `ENV_MISSING_REQUIRED` (error)

A variable listed in `env.required` is not defined in any environment file and is not present in the current process environment.

```json
{ "env": { "required": ["DATABASE_URL", "STRIPE_SECRET_KEY"] } }
```

### `ENV_MISSING_VAR` (warning)

Code reads a variable that no environment file defines.

```ts
// fail
const key = process.env.SENDGRID_API_KEY; // not in any .env file
```

Platform provided variables (`NODE_ENV`, `PORT`, `VERCEL_URL`, `CI` and similar) are ignored. Add your own to `env.optional`.

### `ENV_PUBLIC_SECRET` (error)

A browser exposed variable whose name reads like a credential.

```bash
# fail
NEXT_PUBLIC_STRIPE_SECRET_KEY=sk_live_...

# pass, publishable keys are public by design
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

Names containing `PUBLISHABLE`, `SITE_KEY`, `CLIENT_ID`, `ANON_KEY` or `PUBLIC_KEY` are treated as intentional, as are values matching a known public key format (Stripe `pk_`, Google Analytics `G-`, PostHog `phc_`, reCAPTCHA site keys, Mapbox `pk.`). Anything else goes in `env.allowPublic` if it is public on purpose.

This is the same check the security plugin runs as `SECURITY_PUBLIC_SECRET`. One implementation, two codes, so both plugins can be run alone.

### `ENV_SECRET_IN_EXAMPLE` (error)

`.env.example` contains a value matching a real credential format. That file is committed, so the credential is already public and needs rotating, not just deleting.

### `ENV_TYPE_MISMATCH` (warning)

A variable declared in `env.types` holds a value of the wrong shape. Supported types: `string`, `url`, `number`, `boolean`, `email`. The report names the variable and the expected type; it never prints the value.

### `ENV_FILE_DRIFT` (warning, fixable)

A key exists in `.env` or `.env.local` but not in `.env.example`.

### `ENV_EXAMPLE_MISSING` (warning, fixable)

There is no `.env.example` at all. Reported once for the whole project, not once per variable.

### `ENV_UNUSED_VAR` (warning)

A variable is defined but never read in application code. `.env.example` is exempt, since listing unused keys is the point of a template. Common tooling prefixes (`NEXT_`, `VERCEL_`, `SENTRY_`, `PRISMA_`, `AUTH_`, `SUPABASE_`, `CLERK_` and similar) are exempt too, because a framework reads them rather than your code.

## What `--fix` does

Only two things, both safe:

- creates `.env.example` when it is missing
- appends the missing keys to `.env.example` as empty placeholders under a generated comment

It never writes to `.env`, `.env.local`, `.env.production`, `.env.development`, `.env.test` or `.env.staging`, never copies a value from a real environment file into the template, and never invents a secret. That restriction is enforced in a single place in the code with its own tests.

## Configuration

See [Configuration](../02-configuration.md#env) for the full `env` block.

## A note on your secrets

The plugin parses values so it can type check them, but a value never reaches the report. Findings reference variable names and expected shapes only. There is a test that scans the generated reports of every fixture for known secret values and fails if one appears.
