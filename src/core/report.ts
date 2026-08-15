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

/**
 * The default view once a project has more findings than anyone wants to read
 * in a terminal. Counts per plugin, the rules doing the most damage, and the
 * files carrying the most findings. The detail goes to a file.
 */
export function formatTerminalSummary(
  report: RunReport,
  opts: { reportPath: string | null; fix: boolean },
): string {
  const lines: string[] = [];
  const meta = [
    report.project.frameworkLabel,
    report.project.typescript ? "TypeScript" : "JavaScript",
    report.project.router !== "none" ? routerLabel(report.project.router) : null,
  ].filter(Boolean) as string[];

  const { errors, warnings, passed, fixable, score } = report.summary;

  lines.push("");
  lines.push(c.bold(c.cyan("NEXT DOC")));
  lines.push(c.dim(meta.join("  ")));
  lines.push("");
  lines.push(
    `  ${c.red(`${icons.fail} ${errors} error${errors === 1 ? "" : "s"}`)}   ` +
      `${c.yellow(`${icons.warn} ${warnings} warning${warnings === 1 ? "" : "s"}`)}   ` +
      `${c.green(`${icons.pass} ${passed} passed`)}   ` +
      `${c.dim("Score")} ${scoreColor(score)}${c.dim("/100")}`,
  );
  lines.push("");

  // Per plugin totals.
  for (const result of report.results) {
    const e = result.findings.filter((f) => f.severity === "error").length;
    const w = result.findings.filter((f) => f.severity === "warning").length;
    const title = (PLUGIN_TITLES[result.plugin] ?? result.plugin).padEnd(14);
    const counts = e === 0 && w === 0 ? c.green("clean") : `${e} error${e === 1 ? "" : "s"}, ${w} warning${w === 1 ? "" : "s"}`;
    lines.push(`  ${c.bold(title)} ${c.dim(counts)}`);
  }

  const actionable = report.results
    .flatMap((r) => r.findings)
    .filter((f) => f.severity !== "pass");

  if (actionable.length > 0) {
    const byCode = new Map<string, number>();
    for (const f of actionable) byCode.set(f.code, (byCode.get(f.code) ?? 0) + 1);
    const topCodes = [...byCode.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    lines.push("");
    lines.push(c.bold("  Most common"));
    for (const [code, count] of topCodes) {
      lines.push(`    ${c.dim(String(count).padStart(5))}  ${code}`);
    }

    const byFile = new Map<string, number>();
    for (const f of actionable) {
      if (!f.file) continue;
      byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1);
    }
    const topFiles = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    if (topFiles.length > 0) {
      lines.push("");
      lines.push(c.bold("  Worst files"));
      for (const [file, count] of topFiles) {
        lines.push(`    ${c.dim(String(count).padStart(5))}  ${file}`);
      }
    }
  }

  lines.push("");
  if (opts.reportPath) {
    lines.push(`  ${c.green("Full report:")} ${c.bold(opts.reportPath)}`);
    lines.push(c.dim("  Open it for every finding, grouped by plugin and rule."));
  }
  if (!opts.fix && fixable > 0) {
    lines.push(c.dim(`  Run next-doc --fix to apply ${fixable} automatic fix${fixable === 1 ? "" : "es"}.`));
  }
  lines.push(c.dim("  Run next-doc --full to print everything here instead."));
  lines.push("");

  return lines.join("\n");
}

/**
 * The written report. Grouped by plugin, then by rule, so a thousand instances
 * of one rule read as one section with a file list rather than a thousand
 * repeated paragraphs.
 */
export function formatMarkdownReport(report: RunReport, opts: { command: string } = { command: "next-doc" }): string {
  const lines: string[] = [];
  const { errors, warnings, passed, fixable, score } = report.summary;
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);

  lines.push("# Next Doc report");
  lines.push("");
  lines.push(`Generated ${stamp} UTC by \`${opts.command}\``);
  lines.push("");
  lines.push(`**Score ${score}/100**`);
  lines.push("");
  lines.push("| | Count |");
  lines.push("| --- | --- |");
  lines.push(`| Errors | ${errors} |`);
  lines.push(`| Warnings | ${warnings} |`);
  lines.push(`| Passed | ${passed} |`);
  lines.push(`| Fixable | ${fixable} |`);
  lines.push("");
  lines.push(`Project: ${report.project.frameworkLabel}, ${report.project.typescript ? "TypeScript" : "JavaScript"}.`);
  lines.push("");

  // Contents, so a long report stays navigable.
  lines.push("## Contents");
  lines.push("");
  for (const result of report.results) {
    const e = result.findings.filter((f) => f.severity === "error").length;
    const w = result.findings.filter((f) => f.severity === "warning").length;
    const title = PLUGIN_TITLES[result.plugin] ?? result.plugin;
    lines.push(`- [${title}](#${title.toLowerCase()}) ${e} errors, ${w} warnings`);
  }
  lines.push("");

  for (const result of report.results) {
    const title = PLUGIN_TITLES[result.plugin] ?? result.plugin;
    lines.push("---");
    lines.push("");
    lines.push(`## ${title}`);
    lines.push("");

    const actionable = result.findings.filter((f) => f.severity !== "pass");
    const passes = result.findings.filter((f) => f.severity === "pass");

    if (actionable.length === 0) {
      lines.push("Nothing to fix here.");
      lines.push("");
      for (const p of passes) lines.push(`- ${p.message}`);
      lines.push("");
      continue;
    }

    // Group by rule code, worst first.
    const groups = new Map<string, Finding[]>();
    for (const f of actionable) {
      const list = groups.get(f.code) ?? [];
      list.push(f);
      groups.set(f.code, list);
    }

    const ordered = [...groups.entries()].sort((a, b) => {
      const sev = (g: Finding[]) => (g.some((f) => f.severity === "error") ? 0 : 1);
      return sev(a[1]) - sev(b[1]) || b[1].length - a[1].length;
    });

    for (const [code, findings] of ordered) {
      const severity = findings.some((f) => f.severity === "error") ? "Error" : "Warning";
      lines.push(`### \`${code}\``);
      lines.push("");
      lines.push(`${severity}, ${findings.length} occurrence${findings.length === 1 ? "" : "s"}.`);
      lines.push("");

      const suggestion = findings.find((f) => f.suggestion)?.suggestion;
      if (suggestion) {
        lines.push(`> ${suggestion}`);
        lines.push("");
      }

      const located = findings.filter((f) => f.file);
      if (located.length > 0) {
        lines.push("| Location | Finding |");
        lines.push("| --- | --- |");
        for (const f of located.slice(0, 200)) {
          const loc = f.line ? `${f.file}:${f.line}` : f.file!;
          lines.push(`| \`${loc}\` | ${escapePipes(shorten(f.message))} |`);
        }
        if (located.length > 200) {
          lines.push(`| ... | ${located.length - 200} more, use --json for the complete list |`);
        }
      } else {
        for (const f of findings) lines.push(`- ${escapePipes(f.message)}`);
      }
      lines.push("");
    }

    if (passes.length > 0) {
      lines.push("<details><summary>Passed checks</summary>");
      lines.push("");
      for (const p of passes) lines.push(`- ${p.message}`);
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(`<sub>${PACKAGE_NAME} v${VERSION}. Suppress a finding with a \`next-doc-ignore\` comment.</sub>`);
  lines.push("");
  return lines.join("\n");
}

/** Trims the file path prefix that the location column already shows. */
function shorten(message: string): string {
  return message.replace(/^\S+\.(tsx?|jsx?|mjs|cjs)\s+/, "");
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
