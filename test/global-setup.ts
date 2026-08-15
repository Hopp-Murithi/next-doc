import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The CLI tests run the real binary, so they need dist/cli.js. Building it here
 * rather than assuming it exists means `vitest` works on a clean checkout and
 * the suite cannot fail for a reason that has nothing to do with the code.
 */
export default function setup(): void {
  if (existsSync(path.join(root, "dist", "cli.js"))) return;

  execFileSync("npx", ["tsup"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}
