import path from "node:path";
import type { AppliedFix, PluginName, RunReport, ScanContext } from "./core/types.js";
import { loadConfig } from "./core/config.js";
import { detectFramework, readPackageJson } from "./core/detect.js";
import { createFileIndex } from "./core/scan.js";
import { registerPlugin, runPlugins } from "./core/plugin.js";
import { buildReport } from "./core/report.js";
import { NextDocError, EXIT } from "./core/exit-codes.js";
import { envPlugin } from "./plugins/env/index.js";
import { securityPlugin } from "./plugins/security/index.js";
import { performancePlugin } from "./plugins/performance/index.js";
import { idempotencyPlugin } from "./plugins/idempotency/index.js";

registerPlugin(envPlugin);
registerPlugin(securityPlugin);
registerPlugin(performancePlugin);
registerPlugin(idempotencyPlugin);

export { allPlugins, registerPlugin } from "./core/plugin.js";
export { EXIT, NextDocError } from "./core/exit-codes.js";
export { loadConfig, DEFAULT_CONFIG, configSchema } from "./core/config.js";
export { detectFramework } from "./core/detect.js";
export { formatJson, formatMarkdown, formatTerminal, formatScoreOnly } from "./core/report.js";
export type * from "./core/types.js";

export interface RunOptions {
  cwd?: string;
  /** Defaults to every plugin enabled in the config. */
  plugins?: PluginName[];
  configPath?: string;
  fix?: boolean;
  ignore?: string[];
  /** Overrides config.strict. When true, warnings fail the run too. */
  strict?: boolean;
  /** Skip the "is this a React project" guard. Used by tests. */
  allowUnknownProject?: boolean;
}

export interface RunResult {
  report: RunReport;
  fixes: AppliedFix[];
  /** 0, or 1 when the run should fail the build. Honours config.strict. */
  exitCode: number;
}

/**
 * Runs the requested plugins and returns the report. Everything the CLI does
 * beyond formatting lives here, so CI wrappers and tests can call it directly.
 */
export async function runAudit(options: RunOptions = {}): Promise<RunResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const { config } = await loadConfig(cwd, options.configPath);

  if (options.ignore?.length) config.ignore = [...config.ignore, ...options.ignore];
  if (options.strict !== undefined) config.strict = options.strict;

  const framework = await detectFramework(cwd);
  if (framework.name === "unknown" && !options.allowUnknownProject) {
    throw new NextDocError(
      "No Next.js or React project found here.",
      EXIT.NOT_A_PROJECT,
      "nextdoc looks for next.config.*, vite.config.*, or a react dependency in package.json. Run it from your project root, or pass a directory.",
    );
  }

  const fixes: AppliedFix[] = [];
  const ctx: ScanContext = {
    cwd,
    framework,
    config,
    pkg: await readPackageJson(cwd),
    fix: options.fix ?? false,
    files: createFileIndex(cwd, config.ignore),
    fixes,
  };

  const selected = options.plugins?.length ? options.plugins : config.plugins;
  const results = await runPlugins(selected, ctx);
  const report = buildReport(cwd, framework, results, fixes);

  const failing =
    report.summary.errors > 0 || (config.strict && report.summary.warnings > 0) ? EXIT.FINDINGS : EXIT.OK;

  return { report, fixes, exitCode: failing };
}
