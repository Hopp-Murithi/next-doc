import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAudit, loadConfig, EXIT, NextDocError } from "../src/index.js";
import { assertWritable, applyFix, ProtectedFileError } from "../src/core/fixer.js";
import { formatJson, formatMarkdown, formatTerminal } from "../src/core/report.js";
import { parseEnvText } from "../src/core/env-file.js";
import { stripCommentsAndStrings } from "../src/core/scan.js";
import type { ScanContext } from "../src/core/types.js";
import { fixture } from "./helpers.js";
import { VERSION } from "../src/version.js";

const temps: string[] = [];

async function tempProject(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "next-doc-"));
  temps.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(dir, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("config", () => {
  it("rejects a config with an unknown key instead of silently ignoring it", async () => {
    const dir = await tempProject({
      "next-doc.config.json": JSON.stringify({ plugin: ["env"] }),
    });
    await expect(loadConfig(dir)).rejects.toThrow(/Invalid config/);
  });

  it("reports a missing explicit config path with exit code 2", async () => {
    const dir = await tempProject({});
    await expect(loadConfig(dir, "nope.json")).rejects.toMatchObject({ exitCode: EXIT.CONFIG });
  });

  it("merges user config over the defaults", async () => {
    const dir = await tempProject({
      "next-doc.config.json": JSON.stringify({ strict: true, env: { required: ["DATABASE_URL"] } }),
    });
    const { config } = await loadConfig(dir);

    expect(config.strict).toBe(true);
    expect(config.env.required).toEqual(["DATABASE_URL"]);
    expect(config.plugins).toContain("security");
  });

  it("turns a rule off and downgrades another", async () => {
    const dir = await tempProject({
      "package.json": JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" } }),
      "next.config.js": "module.exports = {};",
      ".env": "NEXT_PUBLIC_API_SECRET_KEY=abc123def456\n",
      "next-doc.config.json": JSON.stringify({
        rules: { ENV_PUBLIC_SECRET: "warn", ENV_EXAMPLE_MISSING: "off" },
      }),
    });

    const { report } = await runAudit({ cwd: dir, plugins: ["env"] });
    const findings = report.results[0]!.findings;

    expect(findings.find((f) => f.code === "ENV_PUBLIC_SECRET")?.severity).toBe("warning");
    expect(findings.some((f) => f.code === "ENV_EXAMPLE_MISSING")).toBe(false);
  });
});

describe("byte order marks", () => {
  // Windows editors and PowerShell write a BOM by default. Without stripping
  // it, JSON.parse throws and the project silently looks like it has no
  // package.json at all, which quietly changes what gets detected.
  const BOM = "﻿";

  it("reads a package.json and a config file that start with a BOM", async () => {
    const dir = await tempProject({
      "package.json": BOM + JSON.stringify({ dependencies: { next: "15.1.0", react: "19.0.0" } }),
      "next.config.js": "module.exports = {};",
      "next-doc.config.json": BOM + JSON.stringify({ env: { required: ["DATABASE_URL"] } }),
    });

    const { config } = await loadConfig(dir);
    expect(config.env.required).toEqual(["DATABASE_URL"]);

    const { report } = await runAudit({ cwd: dir, plugins: ["env"] });
    expect(report.project.frameworkLabel).toBe("Next.js 15.1.0");
  });
});

describe("project detection", () => {
  it("exits with code 3 when there is no React or Next.js project", async () => {
    const dir = await tempProject({ "package.json": JSON.stringify({ name: "not-a-react-app" }) });

    await expect(runAudit({ cwd: dir })).rejects.toBeInstanceOf(NextDocError);
    await expect(runAudit({ cwd: dir })).rejects.toMatchObject({ exitCode: EXIT.NOT_A_PROJECT });
  });
});

describe("the fixer", () => {
  const protectedFiles = [".env", ".env.local", ".env.production", ".env.development", ".env.test"];

  it.each(protectedFiles)("refuses to write %s", (file) => {
    expect(() => assertWritable(file)).toThrow(ProtectedFileError);
    expect(() => assertWritable(`config/${file}`)).toThrow(ProtectedFileError);
  });

  it("allows .env.example", () => {
    expect(() => assertWritable(".env.example")).not.toThrow();
  });

  it("throws before touching the disk even if a rule passes a protected path", async () => {
    const dir = await tempProject({ ".env": "SECRET=keepme\n" });
    const ctx = { cwd: dir, fixes: [] } as unknown as ScanContext;

    await expect(
      applyFix(ctx, { file: ".env", code: "TEST", description: "should never happen", contents: "OVERWRITTEN" }),
    ).rejects.toBeInstanceOf(ProtectedFileError);

    expect(await fs.readFile(path.join(dir, ".env"), "utf8")).toBe("SECRET=keepme\n");
  });

  it("writes only .env.example when --fix runs, leaving real env files untouched", async () => {
    const dir = await tempProject({
      "package.json": JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" } }),
      "next.config.js": "module.exports = {};",
      ".env": "DATABASE_URL=postgresql://localhost/db\nSTRIPE_SECRET_KEY=sk_live_NOT_A_REAL_VALUE\n",
      ".env.local": "DATABASE_URL=postgresql://localhost/dev\n",
    });

    const { fixes } = await runAudit({ cwd: dir, plugins: ["env"], fix: true });

    const example = await fs.readFile(path.join(dir, ".env.example"), "utf8");
    expect(example).toContain("DATABASE_URL=");
    expect(example).toContain("STRIPE_SECRET_KEY=");
    // Placeholders only. A real value must never be copied into the template.
    expect(example).not.toContain("sk_live_NOT_A_REAL_VALUE");
    expect(example).not.toContain("postgresql://localhost/db");

    expect(await fs.readFile(path.join(dir, ".env"), "utf8")).toContain("sk_live_NOT_A_REAL_VALUE");
    expect(fixes.every((fix) => fix.file === ".env.example")).toBe(true);
  });
});

describe("report output", () => {
  it("never prints a secret value in any format", async () => {
    const { report } = await runAudit({ cwd: fixture("next-bad") });
    const outputs = [
      formatJson(report),
      formatMarkdown(report),
      formatTerminal(report, { fix: false }),
    ].join("\n");

    // Values that exist in the fixture's .env and source files. The fixture
    // values are deliberately shaped so they cannot match a real vendor key
    // format, otherwise pushing this repo trips secret scanning.
    expect(outputs).not.toContain("sk_test_NOT_A_REAL_KEY_FIXTURE_ONLY");
    expect(outputs).not.toContain("hunter2");
    expect(outputs).not.toMatch(/postgresql:\/\/[^\s]*:[^\s]*@/);
  });

  it("gives every error and warning a suggestion, which is the review gate for new rules", async () => {
    for (const name of ["next-bad", "next-clean", "vite-react"]) {
      const { report } = await runAudit({ cwd: fixture(name) });
      for (const result of report.results) {
        for (const finding of result.findings) {
          if (finding.severity === "pass") continue;
          expect(finding.suggestion, `${finding.code} in ${name} has no suggestion`).toBeTruthy();
          expect(finding.code).toMatch(/^[A-Z][A-Z0-9_]+$/);
        }
      }
    }
  });

  it("emits a stable, versioned JSON shape", async () => {
    const { report } = await runAudit({ cwd: fixture("next-clean") });
    const parsed = JSON.parse(formatJson(report));

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.tool).toEqual({ name: "next-doc", version: VERSION });
    expect(parsed.project.framework).toBe("next");
    expect(Object.keys(parsed.summary).sort()).toEqual(
      ["errors", "fixable", "fixesApplied", "passed", "score", "warnings"].sort(),
    );
  });

  it("scores a clean project higher than a broken one", async () => {
    const clean = await runAudit({ cwd: fixture("next-clean") });
    const bad = await runAudit({ cwd: fixture("next-bad") });

    expect(clean.report.summary.score).toBeGreaterThan(bad.report.summary.score);
    expect(clean.exitCode).toBe(EXIT.OK);
    expect(bad.exitCode).toBe(EXIT.FINDINGS);
  });

  it("fails on warnings only when strict is on", async () => {
    const relaxed = await runAudit({ cwd: fixture("next-clean"), plugins: ["performance"] });
    const strict = await runAudit({ cwd: fixture("next-clean"), plugins: ["performance"], strict: true });

    expect(relaxed.report.summary.warnings).toBeGreaterThan(0);
    expect(relaxed.exitCode).toBe(EXIT.OK);
    expect(strict.exitCode).toBe(EXIT.FINDINGS);
  });
});

describe("inline suppression", () => {
  it("honours a next-doc-ignore comment on the flagged line and the line above", async () => {
    const dir = await tempProject({
      "package.json": JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" } }),
      "next.config.js": "module.exports = {};",
      "app/api/payments/route.ts": [
        "// next-doc-ignore idempotency",
        "export async function POST(request: Request) {",
        "  return Response.json({ ok: true });",
        "}",
      ].join("\n"),
    });

    const { report } = await runAudit({ cwd: dir, plugins: ["idempotency"] });
    expect(report.results[0]!.findings.some((f) => f.severity === "error")).toBe(false);
  });
});

describe("parsing helpers", () => {
  it("parses dotenv syntax including quotes, export and inline comments", () => {
    const entries = parseEnvText(
      ['export QUOTED="a b"', "PLAIN=value # trailing", "# comment", "", "EMPTY="].join("\n"),
    );

    expect(entries.get("QUOTED")?.value).toBe("a b");
    expect(entries.get("PLAIN")?.value).toBe("value");
    expect(entries.get("EMPTY")?.value).toBe("");
    expect(entries.size).toBe(3);
  });

  it("blanks comments and strings without moving any line numbers", () => {
    const source = ['const a = "fetch(";', "// fetch(", "fetch(url);"].join("\n");
    const stripped = stripCommentsAndStrings(source);

    expect(stripped.split("\n")).toHaveLength(3);
    expect(stripped.split("\n")[0]).not.toContain("fetch(");
    expect(stripped.split("\n")[2]).toContain("fetch(");
  });
});
