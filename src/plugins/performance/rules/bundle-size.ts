import fs from "node:fs/promises";
import path from "node:path";
import type { Finding, Rule, ScanContext } from "../../../core/types.js";
import { finding } from "../../../core/plugin.js";

const KB = 1024;

async function byteSize(abs: string): Promise<number> {
  try {
    const stat = await fs.stat(abs);
    return stat.size;
  } catch {
    return 0;
  }
}

interface RouteSize {
  route: string;
  bytes: number;
}

/** Next.js: sum the JavaScript each route loads, from the build manifests. */
async function nextRouteSizes(cwd: string): Promise<RouteSize[] | null> {
  const manifests = ["app-build-manifest.json", "build-manifest.json"];
  const perRoute = new Map<string, Set<string>>();
  let found = false;

  for (const name of manifests) {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(cwd, ".next", name), "utf8");
    } catch {
      continue;
    }
    found = true;
    const parsed = JSON.parse(raw) as {
      pages?: Record<string, string[]>;
      rootMainFiles?: string[];
    };
    const shared = new Set(parsed.rootMainFiles ?? []);
    for (const [route, files] of Object.entries(parsed.pages ?? {})) {
      const set = perRoute.get(route) ?? new Set<string>();
      for (const file of files) set.add(file);
      for (const file of shared) set.add(file);
      perRoute.set(route, set);
    }
  }

  if (!found) return null;

  const sizes: RouteSize[] = [];
  for (const [route, files] of perRoute) {
    let bytes = 0;
    for (const file of files) {
      if (!file.endsWith(".js")) continue;
      bytes += await byteSize(path.join(cwd, ".next", file));
    }
    sizes.push({ route, bytes });
  }
  return sizes.sort((a, b) => b.bytes - a.bytes);
}

/** Vite, CRA, Astro, Remix: sum the emitted JavaScript in the build directory. */
async function staticBundleSize(cwd: string, buildDirs: string[]): Promise<RouteSize[] | null> {
  for (const dir of buildDirs) {
    const root = path.join(cwd, dir);
    let entries: string[];
    try {
      entries = await walkJs(root);
    } catch {
      continue;
    }
    if (entries.length === 0) continue;
    let bytes = 0;
    for (const file of entries) bytes += await byteSize(file);
    return [{ route: `${dir}/ (all JavaScript)`, bytes }];
  }
  return null;
}

async function walkJs(dir: string, depth = 0): Promise<string[]> {
  if (depth > 6) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkJs(abs, depth + 1)));
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) out.push(abs);
  }
  return out;
}

/**
 * Real numbers only. When there is no build output this rule says so and stops.
 * It never estimates a compiled size from source file size, because the first
 * time someone checks that number against their own build and it disagrees,
 * they stop believing every other number this tool prints.
 */
export const bundleSize: Rule = {
  code: "PERF_LARGE_ROUTE",
  title: "Route JavaScript within budget",
  async run(ctx: ScanContext): Promise<Finding[]> {
    const sizes = ctx.framework.isNext
      ? await nextRouteSizes(ctx.cwd)
      : await staticBundleSize(ctx.cwd, ctx.framework.buildDirs);

    if (sizes === null || sizes.length === 0) {
      const command = ctx.framework.isNext ? "next build" : "your production build";
      return [
        finding.warn({
          code: "PERF_NO_BUILD_OUTPUT",
          message: `No build output found, so bundle sizes were not measured`,
          fixable: false,
          suggestion: `Run ${command} first, then run next-doc performance again for real bundle numbers.`,
        }),
      ];
    }

    const budget = ctx.config.performance.maxRouteKb * KB;
    const over = sizes.filter((s) => s.bytes > budget);

    if (over.length === 0) {
      const largest = sizes[0]!;
      return [
        finding.pass({
          code: "PERF_LARGE_ROUTE",
          message: `Largest route ships ${Math.round(largest.bytes / KB)}kb of JavaScript, under the ${ctx.config.performance.maxRouteKb}kb budget`,
        }),
      ];
    }

    return over.map((entry, index) =>
      finding.error({
        code: "PERF_LARGE_ROUTE",
        message: `${entry.route} ships ${Math.round(entry.bytes / KB)}kb of JavaScript${index === 0 ? ", the largest route in the app" : ""}`,
        fixable: false,
        suggestion:
          "Look for client only imports that could move behind a Server Component boundary, or load them with next/dynamic. Charting, editor and date libraries are the usual culprits.",
      }),
    );
  },
};
