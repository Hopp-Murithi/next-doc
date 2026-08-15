import type { ScanContext } from "../../core/types.js";
import { lineAt } from "../../core/scan.js";

export interface EnvReference {
  key: string;
  file: string;
  line: number;
}

/**
 * Finds environment variable reads in source. Deliberately a regex pass rather
 * than a full parse: this is a text pattern, not a structural one, and the
 * regex covers every shape people actually write.
 *
 * Supported: process.env.X, process.env["X"], import.meta.env.X (Vite, Astro),
 * import.meta.env["X"].
 */
const PATTERNS = [
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*\]/g,
  /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /import\.meta\.env\[\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*\]/g,
];

/** Variables provided by the platform or the framework, never declared in .env. */
export const AMBIENT_KEYS = new Set([
  "NODE_ENV",
  "PORT",
  "HOST",
  "CI",
  "TZ",
  "PATH",
  "HOME",
  "PWD",
  "ANALYZE",
  "BASE_URL",
  "MODE",
  "DEV",
  "PROD",
  "SSR",
  "npm_package_version",
  "npm_lifecycle_event",
  "NEXT_RUNTIME",
  "NEXT_PHASE",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_REGION",
  "VERCEL_GIT_COMMIT_SHA",
  "NETLIFY",
  "RENDER",
  "FLY_APP_NAME",
  "AWS_REGION",
  "AWS_LAMBDA_FUNCTION_NAME",
]);

let cache: WeakMap<object, Promise<EnvReference[]>> = new WeakMap();

export function resetUsageCache(): void {
  cache = new WeakMap();
}

export async function collectEnvReferences(ctx: ScanContext): Promise<EnvReference[]> {
  const cached = cache.get(ctx);
  if (cached) return cached;

  const promise = (async () => {
    const sources = await ctx.files.sources();
    const refs: EnvReference[] = [];
    for (const source of sources) {
      for (const pattern of PATTERNS) {
        const rx = new RegExp(pattern.source, pattern.flags);
        let m: RegExpExecArray | null;
        while ((m = rx.exec(source.text)) !== null) {
          const key = m[1];
          if (!key) continue;
          refs.push({ key, file: source.path, line: lineAt(source.text, m.index) });
        }
      }
    }
    return refs;
  })();

  cache.set(ctx, promise);
  return promise;
}

export async function referencedKeys(ctx: ScanContext): Promise<Map<string, EnvReference>> {
  const refs = await collectEnvReferences(ctx);
  const map = new Map<string, EnvReference>();
  for (const ref of refs) {
    if (!map.has(ref.key)) map.set(ref.key, ref);
  }
  return map;
}
