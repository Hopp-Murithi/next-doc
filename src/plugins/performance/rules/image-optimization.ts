import type { Finding, Rule, ScanContext } from "../../../core/types.js";
import { finding } from "../../../core/plugin.js";
import { matchesWithLines } from "../../../core/scan.js";

const IMG_TAG = /<img\b[^>]*>/g;

export const imageOptimization: Rule = {
  code: "PERF_UNOPTIMIZED_IMAGE",
  title: "Images are optimized",
  async run(ctx: ScanContext): Promise<Finding[]> {
    const sources = await ctx.files.sources();
    const findings: Finding[] = [];
    let total = 0;

    for (const file of sources) {
      for (const { match, line } of matchesWithLines(file.text, IMG_TAG)) {
        const tag = match[0];
        total++;
        // An <img> rendered by next/image or by an intentional escape hatch is fine.
        if (/data-no-optimize|\bunoptimized\b/.test(tag)) continue;

        if (ctx.framework.isNext) {
          findings.push(
            finding.warn({
              code: "PERF_UNOPTIMIZED_IMAGE",
              message: `${file.path} uses a raw img tag instead of next/image`,
              file: file.path,
              line,
              fixable: false,
              suggestion:
                "Import Image from next/image so the file is resized, converted to a modern format and served with the right cache headers. Raw img tags skip all of that.",
            }),
          );
          continue;
        }

        const hasDimensions = /\bwidth\s*=/.test(tag) && /\bheight\s*=/.test(tag);
        const hasLazy = /loading\s*=\s*{?["']?lazy/.test(tag);
        if (hasDimensions && hasLazy) continue;

        const problems = [
          hasDimensions ? null : "no width and height",
          hasLazy ? null : "no loading=\"lazy\"",
        ].filter(Boolean);

        findings.push(
          finding.warn({
            code: "PERF_UNOPTIMIZED_IMAGE",
            message: `${file.path} renders an img with ${problems.join(" and ")}`,
            file: file.path,
            line,
            fixable: false,
            suggestion:
              "Set explicit width and height to stop layout shift, and add loading=\"lazy\" to anything below the fold. Serve modern formats through your image host or a build time plugin.",
          }),
        );
      }
    }

    if (findings.length === 0 && total > 0) {
      return [
        finding.pass({ code: "PERF_UNOPTIMIZED_IMAGE", message: `All ${total} images are optimized` }),
      ];
    }

    return findings;
  },
};
