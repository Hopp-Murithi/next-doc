import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { FileIndex, SourceFile } from "./types.js";

export const SOURCE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"];

/** Normalises a Windows path to the POSIX form used everywhere in reports. */
export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/**
 * Strips a UTF-8 byte order mark. Windows editors and PowerShell write these by
 * default, and a BOM makes JSON.parse throw on an otherwise valid package.json
 * or config file. Every file this tool reads goes through here.
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function directiveOf(text: string): { client: boolean; server: boolean } {
  // A directive must be the first statement in the file. Comments and blank
  // lines may precede it, nothing else. Cheap to check without a parser.
  const head = text.slice(0, 2000);
  const lines = head.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;
    if (/^["']use client["'];?$/.test(line)) return { client: true, server: false };
    if (/^["']use server["'];?$/.test(line)) return { client: false, server: true };
    return { client: false, server: false };
  }
  return { client: false, server: false };
}

/** 1-based line number of a character offset. */
export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/** Finds every match of `re` with its line number. `re` must be global. */
export function matchesWithLines(
  text: string,
  re: RegExp,
): Array<{ match: RegExpExecArray; line: number }> {
  const out: Array<{ match: RegExpExecArray; line: number }> = [];
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    out.push({ match: m, line: lineAt(text, m.index) });
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return out;
}

export function createFileIndex(cwd: string, ignore: string[]): FileIndex {
  let sourceCache: Promise<SourceFile[]> | null = null;
  const readCache = new Map<string, Promise<string | null>>();

  async function glob(patterns: string[]): Promise<string[]> {
    const entries = await fg(patterns, {
      cwd,
      ignore,
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: false,
      suppressErrors: true,
    });
    return entries.map(toPosix).sort();
  }

  async function read(relPath: string): Promise<string | null> {
    const key = toPosix(relPath);
    if (!readCache.has(key)) {
      readCache.set(
        key,
        fs
          .readFile(path.join(cwd, key), "utf8")
          .then(stripBom)
          .catch(() => null),
      );
    }
    return readCache.get(key)!;
  }

  async function sources(): Promise<SourceFile[]> {
    sourceCache ??= (async () => {
      const files = await glob([`**/*.{${SOURCE_EXTENSIONS.join(",")}}`]);
      const loaded = await Promise.all(
        files.map(async (rel): Promise<SourceFile | null> => {
          const text = await read(rel);
          if (text === null) return null;
          const directive = directiveOf(text);
          return {
            path: rel,
            absPath: path.join(cwd, rel),
            text,
            isClient: directive.client,
            isServerAction: directive.server,
          };
        }),
      );
      return loaded.filter((f): f is SourceFile => f !== null);
    })();
    return sourceCache;
  }

  return {
    sources,
    glob,
    read,
    async exists(relPath: string): Promise<boolean> {
      try {
        await fs.access(path.join(cwd, relPath));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Strips comments and string literals so keyword scans do not match text that
 * only appears inside a comment or a string. Positions are preserved by
 * replacing removed characters with spaces, so line numbers stay correct.
 */
export function stripCommentsAndStrings(text: string): string {
  const out = text.split("");
  let i = 0;
  const n = text.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };

  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      blank(i, end === -1 ? n : end);
      i = end === -1 ? n : end;
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      blank(i, end === -1 ? n : end + 2);
      i = end === -1 ? n : end + 2;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === quote) break;
        j++;
      }
      blank(i, Math.min(j + 1, n));
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join("");
}
