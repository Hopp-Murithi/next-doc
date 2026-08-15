import type { Finding, Rule, ScanContext } from "../../core/types.js";
import { finding } from "../../core/plugin.js";
import { loadEnvFiles } from "../../core/env-file.js";
import { isPublicName, looksLikePublishableValue, looksLikeSecretName } from "../../core/secrets.js";
import { referencedKeys } from "../env/usage.js";

/**
 * Public prefixes inline the value into the browser bundle. A variable that is
 * both browser exposed and named like a credential is the single highest value
 * finding this tool produces, so the env plugin and the security plugin both
 * run it. Same logic, two stable codes, one implementation.
 */
export function publicSecretLeakRule(code: string): Rule {
  return {
    code,
    title: "No secrets exposed to the client bundle",
    async run(ctx: ScanContext): Promise<Finding[]> {
      const prefixes = ctx.framework.publicEnvPrefixes;
      if (prefixes.length === 0) return [];

      const allowed = new Set(ctx.config.env.allowPublic);
      const envFiles = await loadEnvFiles(ctx);
      const refs = await referencedKeys(ctx);
      const findings: Finding[] = [];
      const seen = new Set<string>();

      const flag = (key: string, fallbackFile?: string, fallbackLine?: number) => {
        if (seen.has(key) || allowed.has(key)) return;
        seen.add(key);
        const ref = refs.get(key);
        const prefix = prefixes.find((p) => key.startsWith(p)) ?? prefixes[0]!;
        findings.push(
          finding.error({
            code,
            message: `${key} looks like a secret exposed to the client`,
            ...(ref
              ? { file: ref.file, line: ref.line }
              : fallbackFile
                ? { file: fallbackFile, ...(fallbackLine ? { line: fallbackLine } : {}) }
                : {}),
            fixable: false,
            suggestion: `Rename it without the ${prefix} prefix and read it server side only. Anything with this prefix is inlined into the JavaScript your users download.`,
          }),
        );
      };

      for (const file of envFiles) {
        for (const entry of file.entries.values()) {
          if (!isPublicName(entry.key, prefixes)) continue;
          if (!looksLikeSecretName(entry.key)) continue;
          if (entry.value && looksLikePublishableValue(entry.value)) continue;
          flag(entry.key, file.file, entry.line);
        }
      }

      for (const key of refs.keys()) {
        if (!isPublicName(key, prefixes) || !looksLikeSecretName(key)) continue;
        flag(key);
      }

      if (findings.length === 0) {
        const publicCount = [...refs.keys()].filter((k) => isPublicName(k, prefixes)).length;
        return [
          finding.pass({
            code,
            message:
              publicCount > 0
                ? `No secrets found among ${publicCount} browser exposed variables`
                : "No secrets exposed to the client",
          }),
        ];
      }

      return findings;
    },
  };
}
