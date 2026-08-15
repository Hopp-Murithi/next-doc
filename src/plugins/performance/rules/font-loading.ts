import type { Finding, Rule, ScanContext } from "../../../core/types.js";
import { finding } from "../../../core/plugin.js";
import { matchesWithLines } from "../../../core/scan.js";

const FONT_LINK = /<link[^>]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com|\.woff2?)[^>]*>/gi;
const CSS_FONT_IMPORT = /@import\s+url\(["']?https?:\/\/fonts\.googleapis\.com[^)]*\)/gi;

/**
 * Fonts block first paint more often than any other single asset. On Next.js
 * the framework can self host and preload them, elsewhere the fix is a
 * preconnect plus font-display swap.
 */
export const fontLoading: Rule = {
  code: "PERF_FONT_LOADING",
  title: "Fonts load without blocking render",
  async run(ctx: ScanContext): Promise<Finding[]> {
    const htmlFiles = await ctx.files.glob(["**/*.html", "**/*.css"]);
    const sources = await ctx.files.sources();
    const findings: Finding[] = [];

    const targets: Array<{ path: string; text: string }> = [];
    for (const file of htmlFiles) {
      const text = await ctx.files.read(file);
      if (text !== null) targets.push({ path: file, text });
    }
    for (const source of sources) targets.push({ path: source.path, text: source.text });

    let usesFrameworkFonts = false;
    for (const source of sources) {
      if (/from\s+["']next\/font/.test(source.text)) usesFrameworkFonts = true;
    }

    for (const target of targets) {
      for (const { match, line } of matchesWithLines(target.text, FONT_LINK)) {
        const tag = match[0];
        if (/rel\s*=\s*["']?(?:preconnect|dns-prefetch|preload)/i.test(tag)) continue;

        if (ctx.framework.isNext) {
          findings.push(
            finding.warn({
              code: "PERF_FONT_LOADING",
              message: `${target.path} loads a font with a link tag instead of next/font`,
              file: target.path,
              line,
              fixable: false,
              suggestion:
                "Use next/font to self host the font, preload it and eliminate the extra connection. It also removes the layout shift that comes with a swapped webfont.",
            }),
          );
        } else if (!/display=swap/i.test(tag)) {
          findings.push(
            finding.warn({
              code: "PERF_FONT_LOADING",
              message: `${target.path} loads a webfont without display=swap`,
              file: target.path,
              line,
              fixable: false,
              suggestion:
                "Add &display=swap to the font URL and a preconnect to the font host, so text renders immediately instead of waiting on the download.",
            }),
          );
        }
      }

      for (const { line } of matchesWithLines(target.text, CSS_FONT_IMPORT)) {
        findings.push(
          finding.warn({
            code: "PERF_FONT_LOADING",
            message: `${target.path} imports a font inside CSS, which delays the request until the stylesheet parses`,
            file: target.path,
            line,
            fixable: false,
            suggestion: ctx.framework.isNext
              ? "Move the font to next/font so it is self hosted and preloaded."
              : "Replace the CSS @import with a link tag in the document head, with preconnect and display=swap.",
          }),
        );
      }
    }

    if (findings.length === 0) {
      return [
        finding.pass({
          code: "PERF_FONT_LOADING",
          message: usesFrameworkFonts ? "Fonts load through next/font" : "No render blocking font loads found",
        }),
      ];
    }

    return findings;
  },
};
