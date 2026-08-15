# Verification report

Everything that was run before `@wamasoda/nextdoc@0.3.0` shipped,
what it produced, and how to see it for yourself.

Release date: 15 August 2026
Commit: `19e8fcf`
Tag: [`v0.3.0`](https://github.com/Hopp-Murithi/next-doc/releases)

---

## Where everything lives

| What | Where |
| --- | --- |
| Package | [npmjs.com/package/@wamasoda/nextdoc](https://www.npmjs.com/package/@wamasoda/nextdoc) |
| Repository | [github.com/Hopp-Murithi/next-doc](https://github.com/Hopp-Murithi/next-doc) |
| Website | [next-doc-taupe.vercel.app](https://next-doc-taupe.vercel.app) |
| CI runs | [Actions tab](https://github.com/Hopp-Murithi/next-doc/actions) |
| Releases | [All releases](https://github.com/Hopp-Murithi/next-doc/releases) |

---

## Contents

| | Section | Result |
| --- | --- | --- |
| 1 | [Test suite](#1-test-suite) | 84 passing |
| 2 | [Continuous integration](#2-continuous-integration) | Green, 10 jobs |
| 3 | [Security](#3-security) | Zero vulnerabilities |
| 4 | [Bundle budgets](#4-bundle-budgets) | All under budget |
| 5 | [Published package](#5-published-package) | 47 files, 140 kB |
| 6 | [Website](#6-website) | Live, six headers |
| 7 | [Bugs found by this process](#7-bugs-found-by-this-process) | Four, all fixed |
| 8 | [Reproducing all of it](#8-reproducing-all-of-it) | One command |

---

## 1. Test suite

**84 tests, all passing.** Run them with `pnpm run test`.

| File | Tests | Covers |
| --- | --- | --- |
| `test/core.test.ts` | 22 | Config, detection, the fixer, report output |
| `test/runtime/idempotency.test.ts` | 21 | `withIdempotency`, concurrency, failure modes |
| `test/plugins.test.ts` | 16 | All four plugins against fixture projects |
| `test/runtime/adapters.test.ts` | 13 | Memory, Redis and Postgres storage |
| `test/cli.test.ts` | 12 | The real binary, exit codes, output formats |

Runtime: about 8 seconds.

### The tests that matter most

These are the ones worth reading if you only read a few.

**Concurrency.** Twenty identical requests are fired at once with the
same idempotency key. Exactly one gets through, nineteen receive `409`,
and the handler runs once.

**Storage failure.** With the backend unreachable, the wrapper returns
`503` and never runs the handler. Flipping `onStorageError` to
`fail-open` runs it instead. Both directions are asserted.

**Key release.** When a handler throws, the key is freed so a retry can
proceed. A `5xx` response is not stored, so a retry actually retries.

**Secrets never leak.** Every report format is generated from the
fixture projects and scanned for known credential values. If one ever
appears in terminal, JSON or markdown output, the build fails.

**The fixer cannot touch real env files.** `.env`, `.env.local` and
`.env.production` are asserted unwritable, even when a rule passes one
in deliberately.

**Every finding has a suggestion.** Every error and warning across all
three fixture projects must carry a fix suggestion. A new rule without
one fails the suite.

### See it yourself

```bash
git clone https://github.com/Hopp-Murithi/next-doc
cd next-doc
pnpm install
pnpm run test
```

---

## 2. Continuous integration

**Green across 10 jobs.** Latest run:
[31888452634](https://github.com/Hopp-Murithi/next-doc/actions/runs/31888452634).

| Platform | Node 18 | Node 20 | Node 22 |
| --- | --- | --- | --- |
| Ubuntu | pass | pass | pass |
| macOS | pass | pass | pass |
| Windows | pass | pass | pass |

Plus a dependency audit job. Total runtime about one minute.

Windows is in the matrix on purpose. This tool does a lot of path work,
and path handling is where a CLI actually breaks.

### What runs when

| Trigger | Jobs |
| --- | --- |
| Any push or pull request | One full verify job |
| Pushes to `main`, pull requests | Adds the 3 by 3 matrix and the audit |
| Weekly, or on demand | Adds the real world smoke test |

### See it yourself

```bash
gh run list
gh run view <run-id>
```

Or open the [Actions tab](https://github.com/Hopp-Murithi/next-doc/actions).

---

## 3. Security

### Dependency audit

**Zero vulnerabilities.** Four direct dependencies, all widely used:

| Package | Why |
| --- | --- |
| `commander` | Argument parsing |
| `fast-glob` | File matching |
| `picocolors` | Terminal colour, no dependencies |
| `zod` | Config validation |

A clean project with only this package installed audits as
`found 0 vulnerabilities` across its 35 package tree.

> If `npm audit` reports vulnerabilities after installing this, they
> come from your own project's other dependencies. npm audits the whole
> tree and reports the total, whatever you installed last. To check what
> this package alone contributes, install it into an empty folder and
> audit that.

### Verify it yourself

```bash
mkdir audit-probe && cd audit-probe
npm init -y
npm install @wamasoda/nextdoc
npm audit
```

### Design rules with tests behind them

| Rule | Enforced by |
| --- | --- |
| No network calls, no telemetry | No HTTP client in the dependency tree |
| Secret values never printed | Report scan test |
| `--fix` cannot write real env files | Denylist plus a test that asserts it throws |
| Config is validated, unknown keys rejected | Schema test |
| Adapter claims are atomic | Adapter contract tests |

---

## 4. Bundle budgets

The runtime library ends up inside your production app, so it has a
budget that fails the build when exceeded.

| Entry point | Minified | Gzipped | Budget |
| --- | --- | --- | --- |
| `idempotency` core | 5.88 kb | **2.26 kb** | 3 kb |
| Memory adapter | 0.53 kb | 0.32 kb | 1 kb |
| Redis adapter | 1.65 kb | 0.65 kb | 1.5 kb |
| Postgres adapter | 1.68 kb | 0.79 kb | 1.5 kb |

Zero runtime dependencies. Adapters are separate entry points, so you
ship only the one you import.

Direct dependency count is capped at 10 and currently sits at 4. The
CLI's own dependencies never reach your app bundle.

### See it yourself

```bash
pnpm run size
```

---

## 5. Published package

**`@wamasoda/nextdoc@0.3.0`**, 47 files, 140 kB packed, 540 kB unpacked.

The tarball carries `dist`, `docs`, `schema.json`, the README, the
licence and the changelog. No source, no tests, no fixtures.

### Installed and run for real

Before publishing, the tarball was installed into a throwaway Next.js
app, outside the repo, and every command in the getting started guide
was run against it. That is what catches "works in the monorepo, broken
when installed".

That test found a real bug: a `package.json` written with a byte order
mark, which Windows editors do by default, made `JSON.parse` fail
silently and the framework version disappear from the report. Fixed,
with a regression test.

### Verify it yourself

```bash
npx @wamasoda/nextdoc --version
npm view @wamasoda/nextdoc
```

---

## 6. Website

**Live, and returning all six security headers.**

| Header | Value |
| --- | --- |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` |
| `Permissions-Policy` | camera, microphone, geolocation all denied |
| `Content-Security-Policy` | `default-src 'self'`, no external hosts |

One static HTML file, no build step, no dependencies, no external
requests. It follows your system theme and has a toggle.

### Verify it yourself

```bash
curl -I https://next-doc-taupe.vercel.app
```

---

## 7. Bugs found by this process

Four real defects were caught by running this on real projects rather
than on fixtures. They are listed because they are the argument for
doing any of it.

**JSON output truncated at 8 kb.** The CLI exited while stdout was
still flushing, so any `--json` report larger than the pipe buffer
arrived cut in half. It only happened on Linux and macOS, where pipe
writes are asynchronous, so local Windows runs never showed it. Caught
by the CI matrix. Anyone piping the report into a file in CI would have
got invalid JSON.

**A build deleting its own test subject.** The bundler cleaned `dist`
on every build, so a second build starting while the CLI tests were
running deleted the binary underneath them. Caught by a failed publish.

**Byte order marks breaking project detection.** Caught by installing
the real tarball into a real app.

---

## 8. Reproducing all of it

```bash
git clone https://github.com/Hopp-Murithi/next-doc
cd next-doc
pnpm install
pnpm run verify
```

`verify` runs the type check, the build, all 82 tests and the size
budgets in order. It is the same command CI runs and the same one that
guards publishing.

Expected output, in order:

```text
tsc --noEmit          no output means clean
tsup                  builds three entry groups
vitest run            82 passed (82)
check-size.mjs        five ok lines
```
