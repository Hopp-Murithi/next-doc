import type { Finding, Rule, ScanContext } from "../../../core/types.js";
import { finding } from "../../../core/plugin.js";
import { findSecretsInText } from "../../../core/secrets.js";
import { lineAt } from "../../../core/scan.js";

const TEST_PATH = /(^|\/)(test|tests|__tests__|__mocks__|e2e|cypress|fixtures?)(\/|$)/;

/**
 * Credentials pasted straight into source. Matches vendor key formats only, so
 * it does not fire on every long string. The value itself is never printed.
 */
export const hardcodedSecret: Rule = {
  code: "SECURITY_HARDCODED_SECRET",
  title: "No credentials hardcoded in source",
  async run(ctx: ScanContext): Promise<Finding[]> {
    const sources = await ctx.files.sources();
    const findings: Finding[] = [];

    for (const file of sources) {
      const hits = findSecretsInText(file.text);
      if (hits.length === 0) continue;
      const inTests = TEST_PATH.test(file.path);

      for (const hit of hits) {
        const line = lineAt(file.text, hit.index);
        const base = {
          code: "SECURITY_HARDCODED_SECRET",
          message: `${file.path} contains what looks like a ${hit.label}`,
          file: file.path,
          line,
          fixable: false,
          suggestion: inTests
            ? "If this is a fake fixture value, ignore it with a nextdoc-ignore comment. If it is real, rotate it and read it from the environment."
            : "Move it into an environment variable and rotate the credential, since it is already in your git history.",
        };
        findings.push(inTests ? finding.warn(base) : finding.error(base));
      }
    }

    if (findings.length === 0) {
      return [
        finding.pass({ code: "SECURITY_HARDCODED_SECRET", message: "No hardcoded credentials found in source" }),
      ];
    }

    return findings;
  },
};
