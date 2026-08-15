# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Rule codes and the `--json` schema are treated as public API. Renaming a rule
code or removing a JSON field is a breaking change.

## [Unreleased]

## [0.3.2] - 2026-08-15

Links only. No code changed.

### Fixed

- `homepage` now points at nextdoc.online, so the Website link in the npm
  sidebar goes to the site rather than back to the readme it is printed on.
- The Website link in the readme pointed at the vercel.app address instead of
  the domain. Both it and the verification report now use nextdoc.online.
- The vercel.app address permanently redirects to nextdoc.online, so links in
  already published versions land in the right place, and the page declares a
  canonical URL.

## [0.3.1] - 2026-08-15

Documentation only. No code changed.

### Fixed

- The npm page badges for licence and Node version read "package not found".
  shields.io needs the scope URL encoded, otherwise it reads the slash in the
  package name as a path separator.
- The CI badge now filters on the default branch, so a failed release run on a
  tag cannot show the project as failing.
- The README contents list was one wrapping line of links. It is a grouped
  table now, so the page is navigable from the top.

## [0.3.0] - 2026-08-15

### Changed

- **Renamed to `@wamasoda/nextdoc`.** The binary is `nextdoc`, the config file
  is `nextdoc.config.json`, the suppression comment is `nextdoc-ignore`, and
  the written report is `nextdoc-report.md`.
- The old names still work. `next-doc.config.*` is still read, and a
  `// next-doc-ignore` comment is still honoured, because suppression comments
  live in other people's source.

The GitHub repository and the deployed site keep their existing addresses.

## [0.2.0] - 2026-08-15

Making the output usable on a real codebase. A first run on a large app
printed over two thousand lines, which is not a report.

### Added

- **`--report [path]`** writes the full findings to a markdown file, default
  `nextdoc-report.md`, grouped by plugin then by rule code, with one
  suggestion per rule instead of one per occurrence.
- **`--full`** prints every finding in the terminal regardless of count.
- **`--no-report`** never writes a file.

### Changed

- Past 30 findings the terminal shows a summary instead of every finding:
  totals per plugin, the five most common rules, the five worst files, and a
  pointer to the written report. Under 30 findings nothing changes.
- `PERF_LARGE_ROUTE` reports the ten worst routes and a count of the rest,
  rather than one error per route. An app with 418 routes over budget was
  producing 418 errors.
- Default ignores now cover generated output that was being scanned as if it
  were source: `.next-*`, `.open-next`, `.vercel`, `.netlify`, `.wrangler`,
  `.cache`, `.output`, `.svelte-kit`, `out`, `public`, `storybook-static`, and
  minified or bundled files.
- The idempotency rules skip test files. Tests name idempotency keys
  constantly, and that is not a finding.

Together these took a real project from 761 errors and 1575 warnings to 32
errors and 368 warnings, with nothing real removed.

## [0.1.0] - 2026-08-15

First release.

### Added

- **CLI** with four plugins, composable as positional arguments:
  `nextdoc`, `nextdoc env security`, `nextdoc idempotency --help`.
- **env plugin**: browser exposed secrets, variables used in code but never
  defined, required variables, declared value types, drift against
  `.env.example`, credentials committed in `.env.example`, unused variables.
- **security plugin**: security headers, Content Security Policy presence,
  hardcoded credentials, server only modules reachable from the client bundle
  through the import graph, unverified webhook handlers, cookie authenticated
  mutations with no origin check, open redirects.
- **performance plugin**: route JavaScript measured from real build output,
  unnecessary `"use client"` directives, server fetches with no caching intent,
  unoptimized images, render blocking fonts, overlapping dependencies.
- **idempotency plugin**: payment, checkout and webhook mutations with no
  duplicate request protection, and keys that are read but never persisted.
- **Runtime library** at `@wamasoda/nextdoc/idempotency`: `withIdempotency` for
  Web standard handlers and `createIdempotency` for Server Actions, with memory,
  Redis and Postgres adapters as separate entry points. Zero dependencies,
  2.3kb minified and gzipped, enforced by a CI budget.
- **Framework support** beyond Next.js: React on Vite, Create React App, Remix,
  React Router framework mode, Astro with React, and plain React. Framework
  specific rules declare where they apply instead of misfiring.
- **Output formats**: terminal with a non-TTY fallback, `--json` with a
  versioned schema, `--markdown` for pull request comments, `--score`.
- **`--fix`** for `.env.example` drift and, on a Next.js project with no config
  file, a security headers block. Real environment files are on a hard denylist.
- **`init` command** to generate `nextdoc.config.json`.
- **Inline suppression** with `// nextdoc-ignore <rule-or-plugin>`.
- **Documented exit codes** 0 to 4 for CI.
- Documentation set in `docs/`, and a one page site in `website/`.

[Unreleased]: https://github.com/Hopp-Murithi/next-doc/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Hopp-Murithi/next-doc/releases/tag/v0.1.0
