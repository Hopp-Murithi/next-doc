import type { Finding, Rule, ScanContext } from "../../../core/types.js";
import { finding } from "../../../core/plugin.js";
import { matchesWithLines, stripCommentsAndStrings } from "../../../core/scan.js";

/** redirect(x), Response.redirect(x), router.push(x), window.location = x */
const REDIRECT_CALLS = [
  /\bredirect\s*\(\s*([^)]{1,200})\)/g,
  /Response\.redirect\s*\(\s*([^,)]{1,200})/g,
  /NextResponse\.redirect\s*\(\s*([^,)]{1,200})/g,
  /location\.(?:href|replace|assign)\s*(?:=|\(\s*)([^;)\n]{1,200})/g,
];

/** Signs the redirect target came from the request rather than from your code. */
const TAINTED = [
  /searchParams/i,
  /params\./,
  /req(?:uest)?\.(?:url|query|body)/,
  /url\.searchParams/,
  /formData\.get/,
  /\bnext\b\s*[,)]/i,
  /callbackUrl/i,
  /returnTo/i,
  /redirect_?uri/i,
];

/** Evidence the target is validated before use. */
const VALIDATED = [
  /startsWith\s*\(\s*["']\//,
  /new URL\([^)]*\)\.origin/,
  /allow(?:ed)?(?:List|Hosts|Origins|Urls)/i,
  /isSafeRedirect/i,
  /sanitizeRedirect/i,
  /\.test\(/,
];

export const unsafeRedirect: Rule = {
  code: "SECURITY_UNSAFE_REDIRECT",
  title: "Redirect targets are validated",
  async run(ctx: ScanContext): Promise<Finding[]> {
    const sources = await ctx.files.sources();
    const findings: Finding[] = [];

    for (const file of sources) {
      const code = stripCommentsAndStrings(file.text);
      for (const pattern of REDIRECT_CALLS) {
        for (const { match, line } of matchesWithLines(code, pattern)) {
          const arg = match[1] ?? "";
          if (!TAINTED.some((re) => re.test(arg))) continue;
          const window = file.text.slice(Math.max(0, match.index - 400), match.index + 400);
          if (VALIDATED.some((re) => re.test(window))) continue;

          findings.push(
            finding.error({
              code: "SECURITY_UNSAFE_REDIRECT",
              message: `${file.path} redirects to a value taken from the request without validating it`,
              file: file.path,
              line,
              fixable: false,
              suggestion:
                "Only redirect to paths you control. Require the target to start with a single slash, or check it against an allowlist of hosts, otherwise this is an open redirect usable for phishing.",
            }),
          );
        }
      }
    }

    if (findings.length === 0) {
      return [finding.pass({ code: "SECURITY_UNSAFE_REDIRECT", message: "No open redirects detected" })];
    }

    return findings;
  },
};
