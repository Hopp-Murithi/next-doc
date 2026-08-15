import type { AppliedFix, Finding, FrameworkInfo, PluginResult, RunReport } from "./types.js";
import { c, icons } from "./logger.js";
import { PACKAGE_NAME, VERSION } from "../version.js";

const PLUGIN_TITLES: Record<string, string> = {
  env: "ENV",
  security: "SECURITY",
  performance: "PERFORMANCE",
  idempotency: "IDEMPOTENCY",
};

export function buildReport(
  cwd: string,
  framework: FrameworkInfo,
  results: PluginResult[],
  fixes: AppliedFix[],
): RunReport {
  const findings = results.flatMap((r) => r.findings);
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const passed = findings.filter((f) => f.severity === "pass").length;
  const fixable = findings.filter((f) => f.fixable && f.severity !== "pass").length;
  const score =
    results.length === 0
      ? 100
      : Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length);

  return {
    schemaVersion: 1,
    tool: { name: PACKAGE_NAME, version: VERSION },
    project: {
      cwd,
      framework: framework.name,
      frameworkLabel: framework.label,
      router: framework.router,
      typescript: framework.typescript,
    },
    results,
    summary: { errors, warnings, passed, fixable, fixesApplied: fixes.length, score },
    ...(fixes.length > 0 ? { fixes } : {}),
  };
}

function severityIcon(severity: Finding["severity"]): string {
  if (severity === "pass") return c.green(icons.pass);
  if (severity === "warning") return c.yellow(icons.warn);
  return c.red(icons.fail);
}

function location(finding: Finding): string | null {
  if (!finding.file) return null;
  return finding.line ? `${finding.file}:${finding.line}` : finding.file;
}

export function formatTerminal(report: RunReport, opts: { fix: boolean }): string {
  const lines: string[] = [];
  const meta = [
    report.project.frameworkLabel,
    report.project.typescript ? "TypeScript" : "JavaScript",
    report.project.router !== "none" ? routerLabel(report.project.router) : null,
  ].filter(Boolean) as string[];

  lines.push("");
  lines.push(c.bold(c.cyan("NEXT DOC")));
  lines.push(c.dim(meta.join("  ")));
  lines.push("");

  for (const result of report.results) {
    lines.push(c.bold(PLUGIN_TITLES[result.plugin] ?? result.plugin.toUpperCase()));
    if (result.findings.length === 0) {
      lines.push(`  ${c.dim("No checks applied to this project.")}`);
    }
    for (const finding of result.findings) {
      lines.push(`  ${severityIcon(finding.severity)} ${finding.message}`);
      const loc = location(finding);
      if (loc) lines.push(`      ${c.dim(loc)}`);
      if (finding.suggestion && finding.severity !== "pass") {
        lines.push(`      ${c.dim("Suggestion:")} ${finding.suggestion}`);
      }
    }
    for (const note of result.notes ?? []) {
      lines.push(`  ${c.dim(icons.bullet)} ${c.dim(note)}`);
    }
    lines.push("");
  }

  const { errors, warnings, passed, fixable, fixesApplied, score } = report.summary;
  lines.push(`${c.bold("Score:")} ${scoreColor(score)}${c.dim("/100")}`);
  lines.push(
    c.dim(
      `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${
        warnings === 1 ? "" : "s"
      }, ${passed} passed`,
    ),
  );

  if (opts.fix && fixesApplied > 0) {
    lines.push("");
    lines.push(c.green(`Applied ${fixesApplied} fix${fixesApplied === 1 ? "" : "es"}:`));
    for (const fix of report.fixes ?? []) {
      lines.push(`  ${icons.bullet} ${fix.file}: ${fix.description}`);
    }
  } else if (!opts.fix && fixable > 0) {
    lines.push("");
    lines.push(
      `Run ${c.cyan("next-doc --fix")} to apply ${fixable} automatic fix${fixable === 1 ? "" : "es"}.`,
    );
  }

  lines.push(c.dim(`Run ${"next-doc <plugin> --help"} for plugin specific options.`));
  lines.push("");
  return lines.join("\n");
}

function routerLabel(router: RunReport["project"]["router"]): string {
  switch (router) {
    case "app":
      return "App Router";
    case "pages":
      return "Pages Router";
    case "mixed":
      return "App + Pages Router";
    case "spa":
      return "Client rendered";
    default:
      return "";
  }
}

function scoreColor(score: number): string {
  const text = String(score);
  if (score >= 90) return c.green(text);
  if (score >= 70) return c.yellow(text);
  return c.red(text);
}

export function formatJson(report: RunReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatMarkdown(report: RunReport): string {
  const lines: string[] = [];
  const { errors, warnings, passed, score } = report.summary;

  lines.push(`## Next Doc report`);
  lines.push("");
  lines.push(
    `**Score: ${score}/100** ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${
      warnings === 1 ? "" : "s"
    }, ${passed} passed. Project: ${report.project.frameworkLabel}.`,
  );
  lines.push("");

  for (const result of report.results) {
    const actionable = result.findings.filter((f) => f.severity !== "pass");
    lines.push(`### ${PLUGIN_TITLES[result.plugin] ?? result.plugin} (${result.score}/100)`);
    lines.push("");
    if (actionable.length === 0) {
      lines.push("No issues found.");
      lines.push("");
      continue;
    }
    lines.push("| | Code | Finding | Location |");
    lines.push("| --- | --- | --- | --- |");
    for (const f of actionable) {
      const mark = f.severity === "error" ? "FAIL" : "WARN";
      const loc = location(f) ?? "";
      const message = f.suggestion ? `${f.message}<br>_${f.suggestion}_` : f.message;
      lines.push(`| ${mark} | \`${f.code}\` | ${escapePipes(message)} | \`${loc}\` |`);
    }
    lines.push("");
  }

  lines.push(`<sub>Generated by ${PACKAGE_NAME} v${VERSION}</sub>`);
  lines.push("");
  return lines.join("\n");
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, "\\|");
}

export function formatScoreOnly(report: RunReport): string {
  return `${report.summary.score}\n`;
}
