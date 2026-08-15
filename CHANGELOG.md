# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Rule codes and the `--json` schema are treated as public API. Renaming a rule
code or removing a JSON field is a breaking change.

## [Unreleased]

## [0.1.0] - 2026-08-15

First release.

### Added

- **CLI** with four plugins, composable as positional arguments:
  `next-doc`, `next-doc env security`, `next-doc idempotency --help`.
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
- **Runtime library** at `@hopp/next-doc/idempotency`: `withIdempotency` for
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
- **`init` command** to generate `next-doc.config.json`.
- **Inline suppression** with `// next-doc-ignore <rule-or-plugin>`.
- **Documented exit codes** 0 to 4 for CI.
- Documentation set in `docs/`, and a one page site in `website/`.

[Unreleased]: https://github.com/Hopp-Murithi/next-doc/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Hopp-Murithi/next-doc/releases/tag/v0.1.0
