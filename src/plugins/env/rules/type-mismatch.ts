import type { Finding, Rule, ScanContext } from "../../../core/types.js";
import { finding } from "../../../core/plugin.js";
import { loadEnvFiles } from "../../../core/env-file.js";

type ExpectedType = "string" | "url" | "number" | "boolean" | "email";

function matchesType(value: string, type: ExpectedType): boolean {
  const v = value.trim();
  if (v === "") return false;
  switch (type) {
    case "string":
      return true;
    case "number":
      return /^-?\d+(\.\d+)?$/.test(v);
    case "boolean":
      return ["true", "false", "1", "0", "yes", "no"].includes(v.toLowerCase());
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    case "url":
      try {
        // eslint-disable-next-line no-new
        new URL(v);
        return true;
      } catch {
        return false;
      }
  }
}

export const typeMismatch: Rule = {
  code: "ENV_TYPE_MISMATCH",
  title: "Declared variable types match their values",
  async run(ctx: ScanContext): Promise<Finding[]> {
    const types = ctx.config.env.types;
    const keys = Object.keys(types);
    if (keys.length === 0) return [];

    const files = await loadEnvFiles(ctx);
    const findings: Finding[] = [];

    for (const file of files) {
      for (const key of keys) {
        const entry = file.entries.get(key);
        const expected = types[key]!;
        if (!entry) continue;
        // Placeholders in .env.example are not real values.
        if (file.file.includes("example") && entry.value.trim() === "") continue;
        if (matchesType(entry.value, expected)) continue;
        findings.push(
          finding.warn({
            code: "ENV_TYPE_MISMATCH",
            // Never echo the value itself, only the shape that was expected.
            message: `${key} is declared as ${expected} but its value is not a valid ${expected}`,
            file: file.file,
            line: entry.line,
            fixable: false,
            suggestion: `Correct the value of ${key} in ${file.file}, or change its declared type in next-doc.config`,
          }),
        );
      }
    }

    if (findings.length === 0) {
      return [
        finding.pass({
          code: "ENV_TYPE_MISMATCH",
          message: `All ${keys.length} typed variables have valid values`,
        }),
      ];
    }

    return findings;
  },
};
