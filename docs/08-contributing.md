# Contributing

## Setup

```bash
pnpm install
pnpm run build
pnpm run test
```

| Script | What it does |
| --- | --- |
| `pnpm run build` | tsup, dual ESM and CJS, three entry groups |
| `pnpm run test` | vitest, needs `build` first for the CLI tests |
| `pnpm run typecheck` | `tsc --noEmit` |
| `pnpm run size` | Bundle budgets for the runtime subpath, plus the dependency count cap |
| `pnpm run verify` | typecheck, build, test, size. What CI and `prepublishOnly` run |

## Layout

```text
src/
  cli.ts                 commander entry, flags, output selection
  index.ts               programmatic API, plugin registration
  core/
    types.ts             Finding, PluginResult, ScanContext, NextDocPlugin
    config.ts            zod schema, loader, defaults
    detect.ts            framework detection
    scan.ts              file index, source directives, regex helpers
    module-graph.ts      local import resolution for the client server boundary
    report.ts            terminal, json and markdown formatters, scoring
    secrets.ts           shared secret heuristics
    env-file.ts          dotenv parsing
    fixer.ts             safe writes, protected file denylist
    logger.ts            colour, icons, spinner
    exit-codes.ts        documented exit code map
  plugins/<name>/
    index.ts             plugin definition, ordered rule list
    rules/*.ts           one file per rule or per closely related pair
  plugins/shared/        rules used by more than one plugin
  runtime/
    idempotency.ts       withIdempotency, createIdempotency
    types.ts             adapter contract
    adapters/            memory, redis, postgres
test/
  fixtures/              sample project trees, passing and failing
```

## Adding a rule

1. Write it in `src/plugins/<plugin>/rules/`, exporting a `Rule`.
2. Register it in that plugin's `index.ts`, in the order it should be reported.
3. Add a passing case and a failing case to the fixtures.
4. Add tests in `test/plugins.test.ts`.
5. Document it in `docs/03-plugins/<plugin>.md`: what it checks, the code, an example of each outcome.

### Rule checklist

- [ ] The code is stable, `SCREAMING_SNAKE_CASE`, prefixed with the plugin (`ENV_`, `SECURITY_`, `PERF_`, `IDEM_`).
- [ ] Every error and warning carries a `suggestion`. This is a hard gate with a test behind it.
- [ ] Every finding carries a `file` and, where meaningful, a `line`.
- [ ] The message never contains a value read from a `.env` file or from source.
- [ ] Heuristic rules say so in the wording. "Possible missing X", not "missing X".
- [ ] The rule declares `appliesTo` if it only makes sense on one framework.
- [ ] A clean project produces a `pass` finding rather than silence, so people can see the check ran.
- [ ] `fixable: true` only when the fix cannot be wrong.

### Severity

| Severity | Use for |
| --- | --- |
| `error` | A live correctness or security problem. Fails CI. |
| `warning` | Worth fixing, not urgent, or a heuristic that can be wrong. |
| `pass` | The check ran and found nothing. |

## Adding a framework

`src/core/detect.ts` is the only place that knows about frameworks. Add detection, a label, the public env prefixes, and the build directories. Then check which existing rules should declare `appliesTo`. Prefer skipping a rule over reporting something that does not apply: a rule that fires wrongly on a framework teaches people to ignore the whole tool.

## Testing rules

Fixtures live in `test/fixtures/`. Each is a small but realistic project tree:

| Fixture | Purpose |
| --- | --- |
| `next-bad` | Next.js App Router with a problem for nearly every rule |
| `next-clean` | The same shapes done correctly |
| `vite-react` | React on Vite, for the non-Next.js paths |

Use `scan(fixture, ["plugin"])` from `test/helpers.ts`, then assert on rule codes rather than message text, so wording can improve without breaking tests.

The runtime tests are the ones to be strict about. Anything touching `withIdempotency` needs a concurrency case, not just a happy path.

## Non negotiables

These have tests and should not be relaxed without a very good reason:

1. `--fix` never writes to a real environment file.
2. No secret value ever appears in any output format.
3. Every error and warning has a suggestion.
4. There is no network call anywhere in the tool.
5. The runtime subpath stays dependency free and inside its size budget.
6. `begin` in any adapter is a single atomic set-if-not-exists.

## Releasing

1. Update `CHANGELOG.md`.
2. Bump the version in `package.json` and in `src/version.ts`. A test asserts they match.
3. `pnpm run verify` and `npm pack --dry-run`, then read the file list.
4. Tag `vX.Y.Z` and push. The release workflow publishes with provenance from CI.

Never publish from a local machine. The provenance attestation is only meaningful when the build is the tagged source built by CI.

## Deploying the site

`website/` is one static HTML file with no build step and no dependencies. Everything it needs is inline.

**Vercel**

```bash
cd website
vercel --prod
```

Or connect the repo in the dashboard and set the root directory to `website`. `website/vercel.json` sets the security headers and a content security policy for it.

**Netlify**

```bash
cd website
netlify deploy --prod
```

`website/netlify.toml` publishes the folder and applies the same headers.

**GitHub Pages**

Push the repo, then in Settings, Pages, select the branch and the `/website` folder. Pages does not support custom headers, so prefer Vercel or Netlify if you want the CSP.

Test it locally with any static server:

```bash
npx serve website
```

Keep the copy in sync with the CLI. The report shown on the page is real output, so if the wording of a finding changes, update the page too.
