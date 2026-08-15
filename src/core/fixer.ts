import fs from "node:fs/promises";
import path from "node:path";
import type { ScanContext } from "./types.js";
import { toPosix } from "./scan.js";

/**
 * Files the fixer must never write to, no matter which rule asks. These hold
 * real secrets. Only .env.example is ever safe to touch. Enforced here, once,
 * rather than trusting every rule to remember it.
 */
const PROTECTED_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
  ".env.staging",
]);

export class ProtectedFileError extends Error {
  constructor(file: string) {
    super(
      `Refusing to modify ${file}. next-doc --fix never writes to real environment files, only to .env.example.`,
    );
    this.name = "ProtectedFileError";
  }
}

export function assertWritable(relPath: string): void {
  const base = path.basename(toPosix(relPath));
  if (PROTECTED_BASENAMES.has(base)) throw new ProtectedFileError(base);
}

export function isProtectedFile(relPath: string): boolean {
  return PROTECTED_BASENAMES.has(path.basename(toPosix(relPath)));
}

/** Writes a file and records the fix on the context. Throws on protected paths. */
export async function applyFix(
  ctx: ScanContext,
  input: { file: string; code: string; description: string; contents: string },
): Promise<void> {
  assertWritable(input.file);
  const abs = path.join(ctx.cwd, input.file);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, input.contents, "utf8");
  ctx.fixes.push({ file: input.file, code: input.code, description: input.description });
}
