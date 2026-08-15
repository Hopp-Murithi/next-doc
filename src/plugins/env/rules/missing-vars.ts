import type { Finding, Rule, ScanContext } from "../../../core/types.js";
import { finding } from "../../../core/plugin.js";
import { allKeys, loadEnvFiles } from "../../../core/env-file.js";
import { AMBIENT_KEYS, referencedKeys } from "../usage.js";

export const missingRequiredVars: Rule = {
  code: "ENV_MISSING_REQUIRED",
  title: "Required variables present",
  async run(ctx: ScanContext): Promise<Finding[]> {
    const required = ctx.config.env.required;
    if (required.length === 0) return [];

    const files = await loadEnvFiles(ctx);
    const defined = allKeys(files);
    const missing = required.filter((key) => !defined.has(key) && !process.env[key]);

    if (missing.length === 0) {
      return [finding.pass({ code: "ENV_MISSING_REQUIRED", message: "Required variables present" })];
    }

    return missing.map((key) =>
      finding.error({
        code: "ENV_MISSING_REQUIRED",
        message: `${key} is required by nextdoc.config but is not defined in any environment file`,
        file: files[0]?.file ?? ".env",
        fixable: false,
        suggestion: `Add ${key} to .env.local for local development and to your hosting provider's environment settings`,
      }),
    );
  },
};

export const missingUsedVars: Rule = {
  code: "ENV_MISSING_VAR",
  title: "Variables used in code are defined",
  async run(ctx: ScanContext): Promise<Finding[]> {
    const files = await loadEnvFiles(ctx);
    if (files.length === 0) return [];

    const defined = allKeys(files);
    const refs = await referencedKeys(ctx);
    const findings: Finding[] = [];

    for (const [key, ref] of refs) {
      if (defined.has(key) || AMBIENT_KEYS.has(key) || ctx.config.env.optional.includes(key)) continue;
      if (process.env[key] !== undefined) continue;
      findings.push(
        finding.warn({
          code: "ENV_MISSING_VAR",
          message: `${key} is read in code but is not defined in any environment file`,
          file: ref.file,
          line: ref.line,
          fixable: false,
          suggestion: `Define ${key} in .env.local, or add it to env.optional in nextdoc.config if the platform provides it`,
        }),
      );
    }

    if (findings.length === 0 && refs.size > 0) {
      return [
        finding.pass({
          code: "ENV_MISSING_VAR",
          message: `All ${refs.size} referenced variables are defined`,
        }),
      ];
    }

    return findings;
  },
};
