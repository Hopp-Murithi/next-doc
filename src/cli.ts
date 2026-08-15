import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { runAudit } from "./index.js";
import { getPlugin } from "./core/plugin.js";
import type { PluginName } from "./core/types.js";
import {
  formatJson,
  formatMarkdown,
  formatMarkdownReport,
  formatScoreOnly,
  formatTerminal,
  formatTerminalSummary,
} from "./core/report.js";
import { NextDocError, EXIT } from "./core/exit-codes.js";
import { c, configureOutput, out, spinner } from "./core/logger.js";
import { CONFIG_FILENAMES, initialConfig } from "./core/config.js";
import { VERSION } from "./version.js";

const PLUGIN_NAMES: PluginName[] = ["env", "security", "performance", "idempotency"];

interface CliFlags {
  fix?: boolean;
  json?: boolean;
  markdown?: boolean;
  score?: boolean;
  strict?: boolean;
  config?: string;
  ignore?: string[];
  color?: boolean;
  cwd?: string;
  report?: string | boolean;
  full?: boolean;
}

/**
 * Above this many findings the terminal gets a summary and the detail goes to
 * a file. A wall of two thousand lines is not a report, it is a scroll.
 */
const SUMMARY_THRESHOLD = 30;
const DEFAULT_REPORT_FILE = "nextdoc-report.md";

/**
 * Signals the intended exit code without calling process.exit.
 *
 * process.exit truncates whatever is still buffered on stdout, because writes
 * to a pipe are asynchronous on Linux and macOS. A --json report larger than
 * the 8kb pipe buffer would arrive cut in half, which is exactly what happens
 * when someone runs `nextdoc --json > report.json` in CI. Setting
 * process.exitCode instead lets Node flush first and exit on its own.
 */
class CliExit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
    this.name = "CliExit";
  }
}

function fail(message: string, hint: string | undefined, code: number): never {
  out.error("");
  out.error(`${c.red("Error:")} ${message}`);
  if (hint) out.error(c.dim(hint));
  out.error("");
  throw new CliExit(code);
}

/** The command as the user typed it, recorded at the top of a written report. */
function commandLine(): string {
  return ["nextdoc", ...process.argv.slice(2)].join(" ");
}

/** `nextdoc env --help` prints the rules that plugin runs. */
function printPluginHelp(names: PluginName[]): void {
  for (const name of names) {
    const plugin = getPlugin(name);
    if (!plugin) continue;
    out.write("");
    out.write(`${c.bold(plugin.name)}  ${c.dim(plugin.description)}`);
    out.write("");
    out.write("  Rules");
    for (const rule of plugin.rules) {
      out.write(`    ${c.cyan(rule.code.padEnd(32))} ${rule.title}`);
    }
    out.write("");
    out.write(c.dim(`  Disable one with { "rules": { "${plugin.rules[0]?.code}": "off" } } in nextdoc.config.json`));
    out.write(c.dim(`  Full reference: docs/03-plugins/${plugin.name}.md`));
  }
  out.write("");
}

async function initCommand(cwd: string): Promise<void> {
  const target = path.join(cwd, "nextdoc.config.json");
  for (const name of CONFIG_FILENAMES) {
    try {
      await fs.access(path.join(cwd, name));
      out.write(`${c.yellow("!")} ${name} already exists, leaving it alone.`);
      return;
    } catch {
      // keep going
    }
  }
  await fs.writeFile(target, `${JSON.stringify(initialConfig(), null, 2)}\n`, "utf8");
  out.write(`${c.green("+")} Created nextdoc.config.json`);
  out.write(c.dim("  Every option is documented in docs/02-configuration.md"));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const namedPlugins = argv.filter((a): a is PluginName => PLUGIN_NAMES.includes(a as PluginName));

  // `nextdoc <plugin> --help` lists that plugin's rules. Handled before
  // commander parses, so plugin names stay composable positional arguments
  // instead of subcommands.
  if ((argv.includes("--help") || argv.includes("-h")) && namedPlugins.length > 0) {
    printPluginHelp(namedPlugins);
    return;
  }

  const program = new Command();

  program
    .name("nextdoc")
    .description("One command. Full picture of your Next.js or React app.")
    .version(VERSION, "-v, --version")
    .argument("[plugins...]", `plugins to run: ${PLUGIN_NAMES.join(", ")}. Defaults to all of them.`)
    .option("--fix", "apply automatic fixes where a finding is marked fixable")
    .option("--json", "machine readable output, stable schema, for CI")
    .option("--markdown", "markdown report, useful as a pull request comment")
    .option("--score", "print only the final score")
    .option("--strict", "treat warnings as errors, so they fail CI too")
    .option("--config <path>", "path to a config file")
    .option("--ignore <glob...>", "extra glob patterns to exclude")
    .option("--no-color", "disable colored output")
    .option("--cwd <path>", "directory to scan, defaults to the current one")
    .option(
      "--report [path]",
      `write the full report to a markdown file, default ${DEFAULT_REPORT_FILE}`,
    )
    .option("--no-report", "never write a report file, print everything instead")
    .option("--full", "print every finding in the terminal, however many there are")
    .addHelpText(
      "after",
      `
Examples:
  $ npx @wamasoda/nextdoc                    run every plugin
  $ npx @wamasoda/nextdoc env security       run two plugins in one pass
  $ npx @wamasoda/nextdoc --fix              apply the safe automatic fixes
  $ npx @wamasoda/nextdoc --json > out.json  machine readable report for CI
  $ npx @wamasoda/nextdoc idempotency --help list the rules a plugin runs

Exit codes:
  0  no errors, or warnings only without --strict
  1  one or more errors found
  2  config file invalid or missing
  3  not a Next.js or React project
  4  internal error, please file an issue with the --json output
`,
    );

  program.command("init").description("generate nextdoc.config.json with sane defaults").action(async () => {
    await initCommand(process.cwd());
  });

  program.action(async (plugins: string[], flags: CliFlags) => {
    configureOutput({ color: flags.color !== false && !flags.json && !flags.markdown });

    const invalid = plugins.filter((name) => !PLUGIN_NAMES.includes(name as PluginName));
    if (invalid.length > 0) {
      fail(
        `Unknown plugin: ${invalid.join(", ")}`,
        `Available plugins: ${PLUGIN_NAMES.join(", ")}`,
        EXIT.INTERNAL,
      );
    }

    const selected = plugins as PluginName[];
    const quiet = Boolean(flags.json || flags.markdown || flags.score);
    const spin = quiet ? null : spinner("Scanning project");

    const { report, exitCode } = await runAudit({
      ...(flags.cwd ? { cwd: flags.cwd } : {}),
      plugins: selected,
      ...(flags.config ? { configPath: flags.config } : {}),
      fix: Boolean(flags.fix),
      ...(flags.ignore ? { ignore: flags.ignore } : {}),
      ...(flags.strict !== undefined ? { strict: flags.strict } : {}),
    });

    spin?.stop();

    if (flags.json) {
      out.write(formatJson(report).trimEnd());
    } else if (flags.markdown) {
      out.write(formatMarkdown(report).trimEnd());
    } else if (flags.score) {
      out.write(formatScoreOnly(report).trimEnd());
    } else {
      const actionable = report.summary.errors + report.summary.warnings;
      const askedForFile = flags.report !== undefined && flags.report !== false;
      const refusedFile = flags.report === false;
      const tooMany = actionable > SUMMARY_THRESHOLD;

      // A file is written when asked for, or when the terminal would otherwise
      // become unreadable. --full and --no-report both opt out.
      const wantsFile = !flags.full && !refusedFile && (askedForFile || tooMany);

      let reportPath: string | null = null;
      if (wantsFile) {
        const target = typeof flags.report === "string" ? flags.report : DEFAULT_REPORT_FILE;
        const abs = path.isAbsolute(target) ? target : path.join(flags.cwd ?? process.cwd(), target);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, formatMarkdownReport(report, { command: commandLine() }), "utf8");
        reportPath = path.relative(process.cwd(), abs) || target;
      }

      if (flags.full || (!tooMany && !reportPath)) {
        out.write(formatTerminal(report, { fix: Boolean(flags.fix) }));
      } else {
        out.write(formatTerminalSummary(report, { reportPath, fix: Boolean(flags.fix) }));
      }
    }

    process.exitCode = exitCode;
  });

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  // fail() throws CliExit rather than exiting, so the code lands here and the
  // process ends on its own once every stream has flushed.
  if (error instanceof CliExit) {
    process.exitCode = error.code;
    return;
  }
  try {
    if (error instanceof NextDocError) {
      fail(error.message, error.hint, error.exitCode);
    }
    const err = error as Error;
    fail(
      err.message || "Unexpected error",
      `This is a bug in nextdoc. Please file an issue with this stack trace:\n${err.stack ?? ""}`,
      EXIT.INTERNAL,
    );
  } catch (exit) {
    process.exitCode = exit instanceof CliExit ? exit.code : EXIT.INTERNAL;
  }
});
