# performance plugin

```bash
npx next-doc performance
```

## What it checks

How much JavaScript each route actually ships, whether components run on the client for a reason, and the asset and caching choices that decide how fast the first paint arrives.

## Why it matters

Bundle weight is the one performance number users feel directly, and it grows by accident: one client only import at the top of a shared component pulls a charting library into a route that never renders a chart. The rest of the plugin covers the defaults that changed under people's feet, particularly fetch caching, which behaves differently across recent Next.js majors.

## Diagnostic only

`--fix` is a deliberate no-op for this plugin. Removing a `"use client"` directive incorrectly breaks the app at runtime, and no static check can tell whether a child component needs the boundary. Every finding here reports `fixable: false`, and a test enforces that.

## Rules

### `PERF_LARGE_ROUTE` (error)

A route ships more JavaScript than `performance.maxRouteKb` (default 250kb).

Numbers come from real build output only:

- **Next.js**: `.next/app-build-manifest.json` and `.next/build-manifest.json`, summing the actual byte size of every `.js` file a route loads, shared chunks included.
- **Vite, CRA, Astro, Remix**: every emitted `.js` file in the build directory.

### `PERF_NO_BUILD_OUTPUT` (warning)

No build output was found, so no sizes were measured.

```text
△ No build output found, so bundle sizes were not measured
    Suggestion: Run next build first, then run next-doc performance again for real bundle numbers.
```

next-doc never estimates a compiled bundle size from source file size. The first time an invented number disagrees with your own build output, every other number the tool prints stops being believable.

### `PERF_UNNECESSARY_USE_CLIENT` (warning, Next.js only)

A file carries `"use client"` but shows no sign of needing the browser: no hooks, no `on*` handlers, no `window`, `document`, `localStorage`, `navigator` or `matchMedia`, no observers or animation frames, no context provider, no class component, no client-only library import (`framer-motion`, `react-hook-form`, `swr`, `@tanstack/react-query`, `zustand`, `jotai`, `react-redux` and similar).

Check the children before removing a directive. They inherit the boundary.

### `PERF_UNCACHED_FETCH` (warning, Next.js only)

A server side `fetch()` with no `cache`, `next` or `revalidate` option, in a file that also has no route segment config (`export const revalidate`, `dynamic` or `fetchCache`).

```ts
// warns
const res = await fetch("https://api.example.com/stats");

// passes, the intent is written down
const res = await fetch("https://api.example.com/stats", { next: { revalidate: 60 } });
const res = await fetch("https://api.example.com/me", { cache: "no-store" });
```

Comments and string literals are stripped before matching, so `"fetch("` inside a string does not count.

### `PERF_UNOPTIMIZED_IMAGE` (warning)

- **Next.js**: a raw `<img>` tag instead of `next/image`.
- **Everywhere else**: an `<img>` without both `width` and `height` (layout shift) or without `loading="lazy"`.

Add `unoptimized` or `data-no-optimize` to the tag to opt out deliberately.

### `PERF_FONT_LOADING` (warning)

- **Next.js**: a font `<link>` tag instead of `next/font`.
- **Everywhere else**: a webfont link without `display=swap`.
- **Everywhere**: `@import url(https://fonts.googleapis.com/...)` inside CSS, which delays the font request until the stylesheet parses.

`rel="preconnect"`, `rel="dns-prefetch"` and `rel="preload"` tags are ignored, since those are the fix rather than the problem. HTML files are scanned as well as source, which is what catches the `index.html` of a Vite or CRA app.

### `PERF_DUPLICATE_DEPS` (warning)

Two or more direct dependencies doing the same job: date libraries, HTTP clients, state libraries, utility libraries, UI kits, styling runtimes, icon sets, form libraries. Only direct dependencies count, since transitive duplicates are a package manager concern rather than a choice you made.

## Configuration

```json
{
  "performance": {
    "maxRouteKb": 180
  }
}
```

See [Configuration](../02-configuration.md#performance).
