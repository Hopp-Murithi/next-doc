# JSON output schema

```bash
npx @wamasoda/nextdoc --json
```

This output is a public API. People pipe it into other tools, so it carries a version and changes to it follow rules.

## Compatibility promise

- `schemaVersion` is `1` today.
- Within a version, fields are added but never removed or retyped, and existing rule codes keep their meaning.
- Removing a field, changing a field's type, or changing what a rule code means bumps `schemaVersion`.
- Renaming a rule code is a breaking change and is treated as one.

Read `schemaVersion` before parsing, and ignore fields you do not recognise.

## Shape

```json
{
  "schemaVersion": 1,
  "tool": {
    "name": "@wamasoda/nextdoc",
    "version": "0.1.0"
  },
  "project": {
    "cwd": "/home/hopp/apps/storefront",
    "framework": "next",
    "frameworkLabel": "Next.js 15.1.0",
    "router": "app",
    "typescript": true
  },
  "results": [
    {
      "plugin": "env",
      "score": 85,
      "findings": [
        {
          "severity": "error",
          "code": "ENV_PUBLIC_SECRET",
          "message": "NEXT_PUBLIC_STRIPE_SECRET_KEY looks like a secret exposed to the client",
          "file": "src/lib/stripe.ts",
          "line": 3,
          "fixable": false,
          "suggestion": "Rename it without the NEXT_PUBLIC_ prefix and read it server side only."
        },
        {
          "severity": "pass",
          "code": "ENV_MISSING_VAR",
          "message": "All 12 referenced variables are defined",
          "fixable": false
        }
      ]
    }
  ],
  "summary": {
    "errors": 1,
    "warnings": 0,
    "passed": 1,
    "fixable": 0,
    "fixesApplied": 0,
    "score": 85
  },
  "fixes": [
    {
      "file": ".env.example",
      "code": "ENV_FILE_DRIFT",
      "description": "added 3 placeholder keys"
    }
  ]
}
```

## Fields

### Top level

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | `1` | Read this first |
| `tool.name` | `string` | Always `@wamasoda/nextdoc` |
| `tool.version` | `string` | Package version that produced the report |
| `project` | `object` | Detected project shape |
| `results` | `PluginResult[]` | One entry per plugin that ran, in the order it ran |
| `summary` | `object` | Totals across every plugin |
| `fixes` | `AppliedFix[]` | Present only when `--fix` applied something |

### `project`

| Field | Type | Values |
| --- | --- | --- |
| `cwd` | `string` | Absolute path scanned |
| `framework` | `string` | `next`, `vite`, `cra`, `remix`, `react-router`, `astro`, `react`, `unknown` |
| `frameworkLabel` | `string` | Human label, for example `React on Vite 6.0.5` |
| `router` | `string` | `app`, `pages`, `mixed`, `spa`, `none` |
| `typescript` | `boolean` | |

### `PluginResult`

| Field | Type | Notes |
| --- | --- | --- |
| `plugin` | `string` | `env`, `security`, `performance`, `idempotency` |
| `score` | `number` | 0 to 100 for this plugin |
| `findings` | `Finding[]` | Includes passes |
| `notes` | `string[]` | Optional. Present when a rule could not run |

### `Finding`

| Field | Type | Notes |
| --- | --- | --- |
| `severity` | `"error" \| "warning" \| "pass"` | |
| `code` | `string` | Stable identifier, `SCREAMING_SNAKE_CASE` |
| `message` | `string` | Never contains a secret value |
| `file` | `string?` | Relative to `cwd`, forward slashes on every platform |
| `line` | `number?` | 1 based |
| `fixable` | `boolean` | Whether `--fix` can apply it |
| `suggestion` | `string?` | Always present on errors and warnings |

### `summary`

| Field | Type | Notes |
| --- | --- | --- |
| `errors` | `number` | |
| `warnings` | `number` | |
| `passed` | `number` | Count of `pass` findings |
| `fixable` | `number` | Actionable findings `--fix` could apply |
| `fixesApplied` | `number` | Fixes actually written this run |
| `score` | `number` | Mean of the plugin scores, rounded |

## Scoring

Per plugin: `100 - (errors × 15) - (warnings × 5)`, floored at 0. Overall: the mean of the plugin scores that ran, rounded. Running a single plugin therefore scores only that plugin.

## What never appears

Environment variable values, file contents, and anything else that could carry a credential. Findings reference names, shapes and locations only. A test scans generated reports for known secret values from the fixtures and fails if one appears.

## Path separators

`file` values always use forward slashes, including on Windows, so the same report is comparable across a mixed platform team.

## Working with it

```bash
# Errors only, as file:line lines
npx @wamasoda/nextdoc --json \
  | jq -r '.results[].findings[] | select(.severity=="error") | "\(.file // "-"):\(.line // 0) \(.code)"'

# Count findings by rule code
npx @wamasoda/nextdoc --json \
  | jq -r '[.results[].findings[] | select(.severity!="pass") | .code] | group_by(.) | map({code: .[0], count: length})'

# Fail a build below a score threshold
test "$(npx @wamasoda/nextdoc --score)" -ge 80
```

## Types

The same shapes are exported as TypeScript types from the package root:

```ts
import type { RunReport, Finding, PluginResult } from "@wamasoda/nextdoc";
```
