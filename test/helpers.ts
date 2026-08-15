import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAudit } from "../src/index.js";
import type { Finding, PluginName, RunResult } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export function fixture(name: string): string {
  return path.join(here, "fixtures", name);
}

export async function scan(name: string, plugins: PluginName[], options: { fix?: boolean } = {}): Promise<RunResult> {
  return runAudit({ cwd: fixture(name), plugins, fix: options.fix ?? false });
}

export function codes(findings: Finding[]): string[] {
  return findings.map((f) => f.code);
}

export function bySeverity(findings: Finding[], severity: Finding["severity"]): Finding[] {
  return findings.filter((f) => f.severity === severity);
}

export function findingsOf(result: RunResult, plugin: PluginName): Finding[] {
  return result.report.results.find((r) => r.plugin === plugin)?.findings ?? [];
}

export function hasCode(findings: Finding[], code: string): boolean {
  return findings.some((f) => f.code === code && f.severity !== "pass");
}

export function passedCode(findings: Finding[], code: string): boolean {
  return findings.some((f) => f.code === code && f.severity === "pass");
}
