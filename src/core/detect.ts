import fs from "node:fs/promises";
import path from "node:path";
import type { FrameworkInfo, FrameworkName, PackageJsonLike } from "./types.js";
import { stripBom } from "./scan.js";

const NEXT_CONFIGS = ["next.config.js", "next.config.mjs", "next.config.cjs", "next.config.ts"];
const VITE_CONFIGS = ["vite.config.js", "vite.config.mjs", "vite.config.ts", "vite.config.mts"];
const ASTRO_CONFIGS = ["astro.config.js", "astro.config.mjs", "astro.config.ts"];
const REMIX_CONFIGS = ["remix.config.js", "remix.config.mjs", "remix.config.ts"];
const RR_CONFIGS = ["react-router.config.js", "react-router.config.ts"];

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function firstExisting(cwd: string, names: readonly string[]): Promise<string | null> {
  for (const name of names) {
    const p = path.join(cwd, name);
    if (await exists(p)) return p;
  }
  return null;
}

export async function readPackageJson(cwd: string): Promise<PackageJsonLike | null> {
  try {
    const raw = await fs.readFile(path.join(cwd, "package.json"), "utf8");
    return JSON.parse(stripBom(raw)) as PackageJsonLike;
  } catch {
    return null;
  }
}

function depVersion(pkg: PackageJsonLike | null, name: string): string | null {
  if (!pkg) return null;
  const v =
    pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? pkg.peerDependencies?.[name] ?? null;
  return v ?? null;
}

function cleanVersion(range: string | null): string | null {
  if (!range) return null;
  const m = /(\d+\.\d+\.\d+|\d+\.\d+|\d+)/.exec(range);
  return m ? m[1]! : range;
}

async function detectSourceDirs(cwd: string): Promise<string[]> {
  const candidates = ["src", "app", "pages", "components", "lib", "server", "islands"];
  const found: string[] = [];
  for (const dir of candidates) {
    if (await exists(path.join(cwd, dir))) found.push(dir);
  }
  return found.length > 0 ? found : ["."];
}

async function detectRouter(cwd: string): Promise<FrameworkInfo["router"]> {
  const hasApp = (await exists(path.join(cwd, "app"))) || (await exists(path.join(cwd, "src/app")));
  const hasPages =
    (await exists(path.join(cwd, "pages"))) || (await exists(path.join(cwd, "src/pages")));
  if (hasApp && hasPages) return "mixed";
  if (hasApp) return "app";
  if (hasPages) return "pages";
  return "none";
}

/**
 * Detects the project shape. Next.js is the primary target, but the scanner
 * also supports plain React projects (Vite, Create React App, Remix, React
 * Router, Astro with a React integration) so the same command works across a
 * team's whole front end. Rules that only make sense on one framework declare
 * `appliesTo` and are skipped elsewhere rather than producing noise.
 */
export async function detectFramework(cwd: string): Promise<FrameworkInfo> {
  const pkg = await readPackageJson(cwd);
  const nextConfig = await firstExisting(cwd, NEXT_CONFIGS);
  const viteConfig = await firstExisting(cwd, VITE_CONFIGS);
  const astroConfig = await firstExisting(cwd, ASTRO_CONFIGS);
  const remixConfig = await firstExisting(cwd, REMIX_CONFIGS);
  const rrConfig = await firstExisting(cwd, RR_CONFIGS);

  const nextVersion = cleanVersion(depVersion(pkg, "next"));
  const reactVersion = cleanVersion(depVersion(pkg, "react"));
  const viteVersion = cleanVersion(depVersion(pkg, "vite"));
  const craVersion = cleanVersion(depVersion(pkg, "react-scripts"));
  const remixVersion =
    cleanVersion(depVersion(pkg, "@remix-run/react")) ?? cleanVersion(depVersion(pkg, "@remix-run/node"));
  const rrVersion = cleanVersion(depVersion(pkg, "react-router"));
  const astroVersion = cleanVersion(depVersion(pkg, "astro"));

  const typescript =
    (await exists(path.join(cwd, "tsconfig.json"))) || Boolean(depVersion(pkg, "typescript"));

  let name: FrameworkName = "unknown";
  let version: string | null = null;
  let configPath: string | null = null;

  if (nextConfig || nextVersion) {
    name = "next";
    version = nextVersion;
    configPath = nextConfig;
  } else if (remixConfig || remixVersion) {
    name = "remix";
    version = remixVersion;
    configPath = remixConfig ?? viteConfig;
  } else if (rrConfig || depVersion(pkg, "@react-router/dev")) {
    // Framework mode only. react-router-dom inside a plain SPA stays a Vite or CRA project.
    name = "react-router";
    version = rrVersion;
    configPath = rrConfig ?? viteConfig;
  } else if (astroConfig || astroVersion) {
    name = "astro";
    version = astroVersion;
    configPath = astroConfig;
  } else if (craVersion) {
    name = "cra";
    version = craVersion;
    configPath = null;
  } else if ((viteConfig || viteVersion) && reactVersion) {
    name = "vite";
    version = viteVersion;
    configPath = viteConfig;
  } else if (reactVersion) {
    name = "react";
    version = reactVersion;
    configPath = null;
  }

  const publicEnvPrefixes = publicPrefixesFor(name, Boolean(viteConfig || viteVersion));
  const router = name === "next" ? await detectRouter(cwd) : name === "unknown" ? "none" : "spa";

  return {
    name,
    label: labelFor(name, version),
    version,
    reactVersion,
    typescript,
    router,
    publicEnvPrefixes,
    sourceDirs: await detectSourceDirs(cwd),
    buildDirs: buildDirsFor(name),
    configPath,
    isNext: name === "next",
    isReact: name !== "unknown",
    hasServerRuntime: name === "next" || name === "remix" || name === "react-router" || name === "astro",
  };
}

function publicPrefixesFor(name: FrameworkName, usesVite: boolean): string[] {
  switch (name) {
    case "next":
      return ["NEXT_PUBLIC_"];
    case "cra":
      return ["REACT_APP_"];
    case "vite":
      return ["VITE_"];
    case "astro":
      return ["PUBLIC_", ...(usesVite ? ["VITE_"] : [])];
    case "remix":
    case "react-router":
      return usesVite ? ["VITE_"] : [];
    case "react":
      return usesVite ? ["VITE_"] : ["REACT_APP_"];
    default:
      return [];
  }
}

function buildDirsFor(name: FrameworkName): string[] {
  switch (name) {
    case "next":
      return [".next"];
    case "cra":
      return ["build"];
    case "remix":
    case "react-router":
      return ["build", "dist"];
    case "astro":
      return ["dist"];
    default:
      return ["dist", "build"];
  }
}

function labelFor(name: FrameworkName, version: string | null): string {
  const v = version ? ` ${version}` : "";
  switch (name) {
    case "next":
      return `Next.js${v}`;
    case "vite":
      return `React on Vite${v}`;
    case "cra":
      return `Create React App${v}`;
    case "remix":
      return `Remix${v}`;
    case "react-router":
      return `React Router${v}`;
    case "astro":
      return `Astro${v}`;
    case "react":
      return `React${v}`;
    default:
      return "Unknown project";
  }
}
