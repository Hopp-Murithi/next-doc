import type { ScanContext } from "./types.js";

export interface EnvEntry {
  key: string;
  value: string;
  line: number;
}

export interface EnvFile {
  /** Path relative to cwd. */
  file: string;
  entries: Map<string, EnvEntry>;
}

/**
 * Minimal dotenv parser. Values are parsed so type checks can run, but they are
 * never written to a report. See docs/07-faq.md, secret values never leave the
 * machine and never appear in any output.
 */
export function parseEnvText(text: string): Map<string, EnvEntry> {
  const entries = new Map<string, EnvEntry>();
  const lines = text.split(/\r?\n/);

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) return;

    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;

    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash !== -1) value = value.slice(0, hash).trim();
    }

    entries.set(key, { key, value, line: index + 1 });
  });

  return entries;
}

export async function loadEnvFiles(ctx: ScanContext): Promise<EnvFile[]> {
  const files: EnvFile[] = [];
  for (const file of ctx.config.env.files) {
    const text = await ctx.files.read(file);
    if (text === null) continue;
    files.push({ file, entries: parseEnvText(text) });
  }
  return files;
}

/** Every key declared across all env files. */
export function allKeys(files: EnvFile[]): Set<string> {
  const keys = new Set<string>();
  for (const f of files) for (const key of f.entries.keys()) keys.add(key);
  return keys;
}
