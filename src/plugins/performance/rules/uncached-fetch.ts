import type { Finding, Rule, ScanContext } from "../../../core/types.js";
import { finding } from "../../../core/plugin.js";
import { lineAt, stripCommentsAndStrings } from "../../../core/scan.js";

/**
 * Server side fetch() with no explicit caching intent. Next.js changed this
 * default between major versions, which is exactly why writing the intent down
 * matters: the same code caches in one version and does not in another.
 */
export const uncachedFetch: Rule = {
  code: "PERF_UNCACHED_FETCH",
  title: "Server fetches declare their caching intent",
  appliesTo: (ctx: ScanContext) => ctx.framework.isNext,
  async run(ctx: ScanContext): Promise<Finding[]> {
    const sources = await ctx.files.sources();
    const findings: Finding[] = [];
    let checked = 0;

    for (const file of sources) {
      if (file.isClient) continue;
      if (!/\.(t|j)sx?$/.test(file.path)) continue;

      const code = stripCommentsAndStrings(file.text);
      // Route segment config covers every fetch in the file.
      if (/export\s+const\s+(revalidate|dynamic|fetchCache)\s*=/.test(code)) continue;

      let index = code.indexOf("fetch(");
      while (index !== -1) {
        const before = code[index - 1] ?? " ";
        if (/[\w.$]/.test(before)) {
          index = code.indexOf("fetch(", index + 6);
          continue;
        }
        checked++;
        const call = code.slice(index, index + 400);
        const hasIntent = /cache\s*:|next\s*:\s*\{|revalidate\s*:/.test(call);
        if (!hasIntent) {
          findings.push(
            finding.warn({
              code: "PERF_UNCACHED_FETCH",
              message: `${file.path} fetches on the server without declaring a caching intent`,
              file: file.path,
              line: lineAt(code, index),
              fixable: false,
              suggestion:
                'Pass { cache: "force-cache" } or { next: { revalidate: 60 } } so the behaviour is explicit and survives a Next.js major upgrade. Use { cache: "no-store" } when the data must always be fresh.',
            }),
          );
        }
        index = code.indexOf("fetch(", index + 6);
      }
    }

    if (findings.length === 0 && checked > 0) {
      return [
        finding.pass({
          code: "PERF_UNCACHED_FETCH",
          message: `All ${checked} server fetches declare their caching intent`,
        }),
      ];
    }

    return findings;
  },
};
