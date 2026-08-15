import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
