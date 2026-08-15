import type { Finding, Rule, ScanContext } from "../../../core/types.js";
import { finding } from "../../../core/plugin.js";
import { applyFix } from "../../../core/fixer.js";

/**
 * Where response headers can be declared differs per framework, so the rule
 * gathers every plausible source and searches all of them:
 *
 *   Next.js        next.config.* headers(), middleware.ts
 *   Vite, CRA      vercel.json, netlify.toml, public/_headers, staticwebapp.config.json
 *   Remix, RR      entry.server.tsx, plus the static host files above
 */
const HEADER_SOURCES = [
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
  "staticwebapp.config.json",
  "app/entry.server.tsx",
  "app/entry.server.jsx",
  "server.js",
  "server.ts",
  "nginx.conf",
];

async function collectHeaderText(ctx: ScanContext): Promise<{ text: string; files: string[] }> {
  const files = [...HEADER_SOURCES, ...ctx.config.security.headerFiles];
  const parts: string[] = [];
  const found: string[] = [];

  for (const file of files) {
    const text = await ctx.files.read(file);
    if (text === null) continue;
    parts.push(text);
    found.push(file);
  }

  return { text: parts.join("\n"), files: found };
}

const NEXT_HEADERS_SNIPPET = `const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
`;

export const securityHeaders: Rule = {
  code: "SECURITY_MISSING_HEADER",
  title: "Security headers configured",
  async run(ctx: ScanContext): Promise<Finding[]> {
    const { text, files } = await collectHeaderText(ctx);
    const required = ctx.config.security.requiredHeaders;
    const missing = required.filter((header) => !new RegExp(header, "i").test(text));

    if (missing.length === 0) {
      return [finding.pass({ code: "SECURITY_MISSING_HEADER", message: "Security headers configured" })];
    }

    // A Next.js project with no headers() at all can be fixed automatically,
    // but only when there is no existing headers config to merge into.
    const nextConfigFile = files.find((f) => f.startsWith("next.config"));
    const hasHeadersFn = /headers\s*\(/.test(text);
    const canGenerate = ctx.framework.isNext && !hasHeadersFn;

    if (canGenerate && ctx.fix && !nextConfigFile) {
      await applyFix(ctx, {
        file: "next.config.mjs",
        code: "SECURITY_MISSING_HEADER",
        description: "created next.config.mjs with a security headers block",
        contents: NEXT_HEADERS_SNIPPET,
      });
      return [
        finding.pass({
          code: "SECURITY_MISSING_HEADER",
          message: "Created next.config.mjs with a security headers block",
        }),
      ];
    }

    const target = nextConfigFile ?? files[0];
    const suggestion = ctx.framework.isNext
      ? hasHeadersFn
        ? `Add ${missing.join(", ")} to the existing headers() block in ${target ?? "next.config.js"}. next-doc will not merge into an existing headers function, that is too risky to automate.`
        : `Add an async headers() block to ${target ?? "next.config.mjs"} returning ${missing.join(", ")}. Run next-doc --fix to scaffold it.`
      : `Set ${missing.join(", ")} at your host or CDN, for example a vercel.json headers block, a netlify.toml [[headers]] block, or a public/_headers file.`;

    // One finding for the whole set: five separate lines for one missing
    // headers block is noise, and it is one edit either way.
    return [
      finding.warn({
        code: "SECURITY_MISSING_HEADER",
        message: `${missing.length} security header${missing.length === 1 ? " is" : "s are"} not configured: ${missing.join(", ")}`,
        ...(target ? { file: target } : {}),
        fixable: canGenerate && !nextConfigFile,
        suggestion,
      }),
    ];
  },
};
