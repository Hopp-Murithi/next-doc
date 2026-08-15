import type { Finding, Rule, ScanContext } from "../../../core/types.js";
import { finding } from "../../../core/plugin.js";
import { lineAt } from "../../../core/scan.js";

const MUTATING_HANDLER = /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b|export\s+const\s+(POST|PUT|PATCH|DELETE)\s*=/g;

const COOKIE_READ = [/cookies\s*\(\)/, /req(?:uest)?\.cookies/, /headers\(\)\.get\(\s*["']cookie/i];

const PROTECTION = [
  /origin/i,
  /referer/i,
  /csrf/i,
  /sec-fetch-site/i,
  /verifyRequestOrigin/,
  /getToken\s*\(/, // NextAuth style token check
  /auth\s*\(\)/, // Auth.js / Clerk helper
  /getServerSession/,
  /authorization/i,
  /bearer/i,
];

/**
 * Cookie authenticated mutations that never look at the request origin are the
 * classic CSRF shape. This is a heuristic: an app using a bearer token, or a
 * framework with built in origin checks, is fine and the rule stays quiet when
 * it sees evidence of either.
 */
export const csrfProtection: Rule = {
  code: "SECURITY_MISSING_CSRF",
  title: "Cookie authenticated mutations check the request origin",
  appliesTo: (ctx: ScanContext) => ctx.framework.hasServerRuntime,
  async run(ctx: ScanContext): Promise<Finding[]> {
    const sources = await ctx.files.sources();
    const findings: Finding[] = [];
    let checked = 0;

    for (const file of sources) {
      if (file.isClient) continue;
      const isRoute = /route\.(t|j)sx?$/.test(file.path) || /api\//.test(file.path);
      if (!isRoute && !file.isServerAction) continue;

      const readsCookies = COOKIE_READ.some((re) => re.test(file.text));
      if (!readsCookies) continue;

      const rx = new RegExp(MUTATING_HANDLER.source, MUTATING_HANDLER.flags);
      let m: RegExpExecArray | null;
      let flagged = false;
      while ((m = rx.exec(file.text)) !== null && !flagged) {
        checked++;
        if (PROTECTION.some((re) => re.test(file.text))) continue;
        flagged = true;
        findings.push(
          finding.warn({
            code: "SECURITY_MISSING_CSRF",
            message: `${file.path} mutates state using cookie auth with no origin or CSRF token check`,
            file: file.path,
            line: lineAt(file.text, m.index),
            fixable: false,
            suggestion:
              "Compare the Origin or Sec-Fetch-Site header against your own host before mutating, or require a CSRF token. Cookie auth alone means any site can trigger this request in a logged in user's browser.",
          }),
        );
      }
    }

    if (findings.length === 0 && checked > 0) {
      return [
        finding.pass({
          code: "SECURITY_MISSING_CSRF",
          message: "Cookie authenticated mutations validate their origin",
        }),
      ];
    }

    return findings;
  },
};
