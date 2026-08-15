import type {
  NextDocPlugin,
  Finding,
  PluginName,
  PluginResult,
  ScanContext,
  Severity,
} from "./types.js";

const registry = new Map<PluginName, NextDocPlugin>();

export function registerPlugin(plugin: NextDocPlugin): void {
  registry.set(plugin.name, plugin);
}

export function getPlugin(name: PluginName): NextDocPlugin | undefined {
  return registry.get(name);
}

export function allPlugins(): NextDocPlugin[] {
  return [...registry.values()];
}

const ERROR_WEIGHT = 15;
const WARNING_WEIGHT = 5;

export function scoreFor(findings: Finding[]): number {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  return Math.max(0, 100 - errors * ERROR_WEIGHT - warnings * WARNING_WEIGHT);
}

// `next-doc-ignore` is accepted too, from the release when the package carried
// that name. Suppression comments live in people's source, so breaking them
// would mean a wave of findings reappearing for no reason.
const IGNORE_RE = /(?:\/\/|\/\*|\{\s*\/\*|#)\s*next-?doc-ignore(?:\s+([\w-]+(?:\s*,\s*[\w-]+)*))?/;

/**
 * Honours `// nextdoc-ignore <code-or-plugin>` written on the flagged line
 * or on the line directly above it. A bare `// nextdoc-ignore` suppresses
 * every finding on that line. Heuristic rules need an escape hatch, otherwise
 * people stop trusting the tool the first time it is wrong.
 */
function isIgnoredInline(text: string, finding: Finding, plugin: PluginName): boolean {
  if (!finding.line) return false;
  const lines = text.split(/\r?\n/);
  const candidates = [lines[finding.line - 1], lines[finding.line - 2]];
  for (const line of candidates) {
    if (!line) continue;
    const m = IGNORE_RE.exec(line);
    if (!m) continue;
    const targets = m[1];
    if (!targets) return true;
    const list = targets.split(",").map((t) => t.trim().toLowerCase());
    if (list.includes(plugin) || list.includes(finding.code.toLowerCase())) return true;
  }
  return false;
}

function applyRuleLevel(finding: Finding, level: "off" | "warn" | "error" | undefined): Finding | null {
  if (!level) return finding;
  if (level === "off") return null;
  if (finding.severity === "pass") return finding;
  const severity: Severity = level === "warn" ? "warning" : "error";
  return { ...finding, severity };
}

export async function runPlugin(plugin: NextDocPlugin, ctx: ScanContext): Promise<PluginResult> {
  const findings: Finding[] = [];
  const notes: string[] = [];

  for (const rule of plugin.rules) {
    if (ctx.config.rules[rule.code] === "off") continue;
    if (rule.appliesTo && !rule.appliesTo(ctx)) continue;

    let produced: Finding[];
    try {
      produced = await rule.run(ctx);
    } catch (err) {
      notes.push(`Rule ${rule.code} failed to run: ${(err as Error).message}`);
      continue;
    }

    for (const raw of produced) {
      const leveled = applyRuleLevel(raw, ctx.config.rules[raw.code]);
      if (!leveled) continue;
      if (leveled.file && leveled.line) {
        const text = await ctx.files.read(leveled.file);
        if (text && isIgnoredInline(text, leveled, plugin.name)) continue;
      }
      findings.push(leveled);
    }
  }

  return {
    plugin: plugin.name,
    findings,
    score: scoreFor(findings),
    ...(notes.length > 0 ? { notes } : {}),
  };
}

export async function runPlugins(names: PluginName[], ctx: ScanContext): Promise<PluginResult[]> {
  const results: PluginResult[] = [];
  for (const name of names) {
    const plugin = registry.get(name);
    if (!plugin) continue;
    results.push(await runPlugin(plugin, ctx));
  }
  return results;
}

/** Convenience builders so rules stay terse and consistent. */
export const finding = {
  error(input: Omit<Finding, "severity" | "fixable"> & { fixable?: boolean }): Finding {
    return { severity: "error", fixable: false, ...input };
  },
  warn(input: Omit<Finding, "severity" | "fixable"> & { fixable?: boolean }): Finding {
    return { severity: "warning", fixable: false, ...input };
  },
  pass(input: { code: string; message: string }): Finding {
    return { severity: "pass", fixable: false, ...input };
  },
};
