# Configuration

Configuration is optional. next-doc runs with sensible defaults on a project that has no config file at all.

## Creating a config

```bash
npx @hopp/next-doc init
```

That writes `next-doc.config.json`. These filenames are picked up automatically, in this order:

1. `next-doc.config.json`
2. `next-doc.config.js`
3. `next-doc.config.mjs`
4. `next-doc.config.cjs`
5. `next-doc.config.ts`

A JavaScript config must export the object as its default export. A TypeScript config only works when the CLI runs through a TypeScript loader such as `tsx`, so JSON is the recommended format.

Point at a different file with `--config path/to/file.json`.

The config is validated with a strict schema. An unknown key is an error, not a silently ignored line, so a typo cannot leave a check quietly disabled. An invalid config exits with code 2.

## Full example

```json
{
  "plugins": ["env", "security", "performance", "idempotency"],
  "ignore": ["**/generated/**", "supabase/functions/**"],
  "strict": false,
  "rules": {
    "ENV_UNUSED_VAR": "off",
    "PERF_UNOPTIMIZED_IMAGE": "warn",
    "SECURITY_MISSING_CSRF": "error"
  },
  "env": {
    "required": ["DATABASE_URL", "STRIPE_SECRET_KEY"],
    "optional": ["ANALYZE", "SENTRY_AUTH_TOKEN"],
    "types": {
      "DATABASE_URL": "url",
      "PORT": "number",
      "ENABLE_BETA": "boolean",
      "SUPPORT_EMAIL": "email"
    },
    "allowPublic": ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"],
    "files": [".env", ".env.local", ".env.example", ".env.production"]
  },
  "security": {
    "requiredHeaders": ["X-Frame-Options", "Content-Security-Policy"],
    "headerFiles": ["infra/cloudfront-headers.json"]
  },
  "performance": {
    "maxRouteKb": 250,
    "maxClientComponentKb": 100
  },
  "idempotency": {
    "pathPatterns": ["payment", "checkout", "webhook", "ledger"],
    "keywords": ["myCustomDedupe"]
  }
}
```

## Options

### `plugins`

Which plugins run when no plugin is named on the command line. Default: all four. Positional arguments on the command line override this.

### `ignore`

Extra glob patterns to exclude, appended to the defaults (`node_modules`, `.next`, `dist`, `build`, `coverage`, `.turbo`, `*.d.ts`). Also available as `--ignore "glob"` on the command line, repeatable.

### `strict`

When true, warnings fail the run the same way errors do. Default false, and the recommendation is to leave it false in the default config and pass `--strict` on the CI step you actually want to gate. A tool that fails CI on warnings by default gets uninstalled the first time it blocks an unrelated release.

### `rules`

Per rule overrides, keyed by the stable rule code shown in every finding.

| Value | Effect |
| --- | --- |
| `"off"` | The rule never runs |
| `"warn"` | Findings from this rule become warnings |
| `"error"` | Findings from this rule become errors |

Rule codes are a public API. See each plugin page for the full list.

### `env`

| Key | Type | Meaning |
| --- | --- | --- |
| `required` | `string[]` | Variables that must exist. Missing ones are errors. |
| `optional` | `string[]` | Variables provided by the platform. Never reported as missing or unused. |
| `types` | `Record<string, "string" \| "url" \| "number" \| "boolean" \| "email">` | Expected value shapes. Mismatches are warnings, and the value itself is never printed. |
| `allowPublic` | `string[]` | Browser exposed variables that are public on purpose, even though the name looks like a credential. |
| `files` | `string[]` | Environment files to read. Default `.env`, `.env.local`, `.env.example`, `.env.development`, `.env.production`. |

### `security`

| Key | Type | Meaning |
| --- | --- | --- |
| `requiredHeaders` | `string[]` | Headers that must appear in your header configuration. |
| `headerFiles` | `string[]` | Extra files to search for headers, for hosts next-doc does not know about. |

Headers are searched for in `next.config.*`, `middleware.*`, `vercel.json`, `netlify.toml`, `public/_headers`, `staticwebapp.config.json`, `entry.server.*`, `server.*` and `nginx.conf`.

### `performance`

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `maxRouteKb` | `number` | `250` | Budget for the JavaScript a single route loads. Measured from real build output only. |
| `maxClientComponentKb` | `number` | `100` | Reserved for a future per component budget. |

### `idempotency`

| Key | Type | Meaning |
| --- | --- | --- |
| `pathPatterns` | `string[]` | Path fragments that mark a money handling route. Replaces the default list. |
| `keywords` | `string[]` | Extra markers that count as idempotency handling. Appended to the defaults. |

## Suppressing a single finding

Heuristic rules need an escape hatch. Add a comment on the flagged line or the line directly above it:

```ts
// next-doc-ignore idempotency
export async function POST(request: Request) {}

// next-doc-ignore IDEM_UNPROTECTED_ROUTE, SECURITY_MISSING_CSRF
export async function PUT(request: Request) {}

export async function PATCH(request: Request) {} // next-doc-ignore
```

A bare `next-doc-ignore` suppresses every finding on that line. Otherwise pass a plugin name or a rule code, comma separated.
