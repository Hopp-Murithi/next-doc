import type { Finding, Rule, ScanContext } from "../../../core/types.js";
import { finding } from "../../../core/plugin.js";
import { loadEnvFiles } from "../../../core/env-file.js";
import { referencedKeys } from "../usage.js";

/** Variables consumed by tooling rather than by application source. */
const TOOLING_KEYS = [
  /^NODE_/,
  /^NPM_/,
  /^PNPM_/,
  /^TURBO_/,
  /^VERCEL_/,
  /^NETLIFY_/,
  /^SENTRY_/,
  /^DATABASE_URL$/,
  /^DIRECT_URL$/,
  /^PRISMA_/,
  /^SUPABASE_/,
  /^AUTH_/,
  /^NEXTAUTH_/,
  /^CLERK_/,
  /^SKIP_/,
];

export const unusedVars: Rule = {
  code: "ENV_UNUSED_VAR",
  title: "No unused variables",
  async run(ctx: ScanContext): Promise<Finding[]> {
    const files = await loadEnvFiles(ctx);
    const refs = await referencedKeys(ctx);
    const findings: Finding[] = [];
    const reported = new Set<string>();

    for (const file of files) {
      // .env.example is a template, unused keys there are the point of the file.
      if (file.file.includes("example") || file.file.includes("sample")) continue;

      for (const entry of file.entries.values()) {
        if (refs.has(entry.key) || reported.has(entry.key)) continue;
        if (TOOLING_KEYS.some((re) => re.test(entry.key))) continue;
        reported.add(entry.key);
        findings.push(
          finding.warn({
            code: "ENV_UNUSED_VAR",
            message: `${entry.key} is defined but never read in application code`,
            file: file.file,
            line: entry.line,
            fixable: false,
            suggestion: `Remove ${entry.key} if it is dead, or add it to env.optional in next-doc.config if a framework or platform reads it`,
          }),
        );
      }
    }

    return findings;
  },
};
