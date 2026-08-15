import type { Finding, Rule, ScanContext } from "../../../core/types.js";
import { finding } from "../../../core/plugin.js";

const CSP_SOURCES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.cjs",
  "next.config.ts",
  "middleware.ts",
  "middleware.js",
  "src/middleware.ts",
  "src/middleware.js",
  "vercel.json",
  "netlify.toml",
  "public/_headers",
  "_headers",
  "index.html",
  "public/index.html",
  "app/entry.server.tsx",
];

/**
 * v1 checks presence only. Grading a policy properly means resolving every
 * script and style source in the app, which is a different piece of work, so
 * this rule deliberately does not claim a policy is correct, only that one exists.
 */
export const contentSecurityPolicy: Rule = {
  code: "SECURITY_NO_CSP",
  title: "Content Security Policy present",
  async run(ctx: ScanContext): Promise<Finding[]> {
    const files = [...CSP_SOURCES, ...ctx.config.security.headerFiles];
    let found: string | null = null;
    let unsafe: { file: string; directive: string } | null = null;

    for (const file of files) {
      const text = await ctx.files.read(file);
      if (text === null) continue;
      if (!/content-security-policy/i.test(text)) continue;
      found ??= file;
      const unsafeMatch = /'unsafe-eval'|'unsafe-inline'/.exec(text);
      if (unsafeMatch && !unsafe) unsafe = { file, directive: unsafeMatch[0] };
    }

    if (!found) {
      return [
        finding.warn({
          code: "SECURITY_NO_CSP",
          message: "Content-Security-Policy not configured",
          fixable: false,
          suggestion: ctx.framework.isNext
            ? "Add a Content-Security-Policy header in next.config headers() or in middleware.ts. Start in report-only mode so you can see what a strict policy would break."
            : "Add a Content-Security-Policy header at your host or CDN. Start in report-only mode so you can see what a strict policy would break.",
        }),
      ];
    }

    const findings: Finding[] = [
      finding.pass({ code: "SECURITY_NO_CSP", message: `Content-Security-Policy configured in ${found}` }),
    ];

    if (unsafe) {
      findings.push(
        finding.warn({
          code: "SECURITY_WEAK_CSP",
          message: `Content-Security-Policy allows ${unsafe.directive}, which removes most of its protection`,
          file: unsafe.file,
          fixable: false,
          suggestion:
            "Replace unsafe directives with a nonce or a hash based policy. nextdoc checks presence only in v1, it does not grade the full policy.",
        }),
      );
    }

    return findings;
  },
};
