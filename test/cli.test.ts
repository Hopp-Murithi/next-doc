import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { VERSION } from "../src/version.js";

const run = promisify(execFile);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "dist", "cli.js");

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function nextDoc(args: string[]): Promise<CliResult> {
  if (!existsSync(cli)) {
    throw new Error("dist/cli.js is missing. Run npm run build before the CLI tests.");
  }
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, ...args], {
      env: { ...process.env, NO_COLOR: "1", CI: "1" },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("cli", () => {
  it("keeps the package version and the reported version in sync", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
    expect(pkg.version).toBe(VERSION);
  });

  it("exits 0 on a clean project and 1 when errors are found", async () => {
    const clean = await nextDoc(["--cwd", fixture("next-clean"), "--score"]);
    const bad = await nextDoc(["--cwd", fixture("next-bad"), "--score"]);

    expect(clean.code).toBe(0);
    expect(bad.code).toBe(1);
    expect(Number(clean.stdout.trim())).toBeGreaterThan(Number(bad.stdout.trim()));
  });

  it("exits 3 when the directory is not a React or Next.js project", async () => {
    const result = await nextDoc(["--cwd", path.join(root, "docs")]);
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("No Next.js or React project found");
  });

  it("exits 2 when an explicitly passed config file is missing", async () => {
    const result = await nextDoc(["--cwd", fixture("next-clean"), "--config", "missing.json"]);
    expect(result.code).toBe(2);
  });

  it("emits parseable json with a schema version", async () => {
    const result = await nextDoc(["--cwd", fixture("next-bad"), "--json"]);

    // Larger than the 8kb pipe buffer on purpose. Calling process.exit while
    // stdout is still draining truncates the report exactly here, and only on
    // Linux and macOS, where pipe writes are asynchronous.
    expect(result.stdout.length).toBeGreaterThan(8192);
    expect(result.stdout.trimEnd().endsWith("}")).toBe(true);

    const parsed = JSON.parse(result.stdout);

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.results).toHaveLength(4);
    expect(result.stdout).not.toContain("["); // no ANSI colour in machine output
  });

  it("runs only the plugins named as positional arguments", async () => {
    const result = await nextDoc(["--cwd", fixture("next-bad"), "env", "security", "--json"]);
    const parsed = JSON.parse(result.stdout);

    expect(parsed.results.map((r: { plugin: string }) => r.plugin)).toEqual(["env", "security"]);
  });

  it("produces a markdown report suitable for a pull request comment", async () => {
    const result = await nextDoc(["--cwd", fixture("next-bad"), "--markdown"]);

    expect(result.stdout).toContain("## Next Doc report");
    expect(result.stdout).toContain("| FAIL | `SECURITY_WEBHOOK_UNVERIFIED`");
  });

  it("writes a grouped markdown report and keeps the terminal short", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "next-doc-report-"));
    const target = path.join(dir, "report.md");

    const result = await nextDoc(["--cwd", fixture("next-bad"), "--report", target]);
    const report = await fs.readFile(target, "utf8");

    // The terminal gets a summary and a pointer, not every finding.
    expect(result.stdout).toContain("Full report:");
    expect(result.stdout).toContain("Most common");
    expect(result.stdout).not.toContain("Suggestion:");

    // The file gets the detail, grouped by plugin and then by rule code.
    expect(report).toContain("# Next Doc report");
    expect(report).toContain("## Contents");
    expect(report).toContain("## SECURITY");
    expect(report).toContain("### `SECURITY_WEBHOOK_UNVERIFIED`");
    expect(report).toContain("| Location | Finding |");

    // One suggestion per rule, not one per occurrence. ENV_UNUSED_VAR fires
    // twice in this fixture, so a per-occurrence report would repeat itself.
    expect(report).toContain("Warning, 2 occurrences.");
    expect(report).toContain("Remove NEXT_PUBLIC_SITE_URL if it is dead");
    expect(report).not.toContain("Remove UNUSED_LEGACY_FLAG if it is dead");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("prints everything when asked, however long it is", async () => {
    const result = await nextDoc(["--cwd", fixture("next-bad"), "--full"]);

    expect(result.stdout).toContain("Suggestion:");
    expect(result.stdout).not.toContain("Full report:");
  });

  it("lists a plugin's rules with <plugin> --help", async () => {
    const result = await nextDoc(["idempotency", "--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("IDEM_UNPROTECTED_ROUTE");
    expect(result.stdout).toContain("docs/03-plugins/idempotency.md");
  });

  it("documents the exit codes in its own help output", async () => {
    const result = await nextDoc(["--help"]);

    expect(result.stdout).toContain("not a Next.js or React project");
    expect(result.stdout).toContain("--strict");
  });

  it("reports its version", async () => {
    const result = await nextDoc(["--version"]);
    expect(result.stdout.trim()).toBe(VERSION);
  });
});
