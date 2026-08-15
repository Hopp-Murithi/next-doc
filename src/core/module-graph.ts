import path from "node:path";
import type { ScanContext, SourceFile } from "./types.js";
import { SOURCE_EXTENSIONS, matchesWithLines, toPosix } from "./scan.js";

export interface ImportRef {
  /** The literal specifier as written, e.g. "./db" or "node:fs". */
  specifier: string;
  line: number;
}

const IMPORT_RE =
  /(?:^|[\s;}])(?:import\s+(?:[\w*{}\n\r\t, ]+\s+from\s+)?|export\s+(?:[\w*{}\n\r\t, ]+\s+from\s+)|require\s*\(\s*|import\s*\(\s*)["']([^"']+)["']/g;

export function parseImports(text: string): ImportRef[] {
  return matchesWithLines(text, IMPORT_RE).map(({ match, line }) => ({
    specifier: match[1]!,
    line,
  }));
}

/**
 * Resolves local import specifiers to files in the project. Handles relative
 * paths, extensionless imports, directory index files, and the common "@/..."
 * and "~/..." aliases pointing at the project root or src.
 *
 * This is deliberately not a full TypeScript resolver. It covers the specifier
 * shapes real Next.js and React apps use, and anything it cannot resolve is
 * simply not followed, which makes the checks conservative rather than wrong.
 */
export class ModuleGraph {
  private byPath = new Map<string, SourceFile>();
  private importsCache = new Map<string, ImportRef[]>();

  constructor(
    sources: SourceFile[],
    private readonly aliasRoots: string[],
  ) {
    for (const source of sources) this.byPath.set(source.path, source);
  }

  static async create(ctx: ScanContext): Promise<ModuleGraph> {
    const sources = await ctx.files.sources();
    const roots = ["src", "app", "."].filter((dir) =>
      dir === "." ? true : sources.some((s) => s.path.startsWith(`${dir}/`)),
    );
    return new ModuleGraph(sources, roots);
  }

  get files(): SourceFile[] {
    return [...this.byPath.values()];
  }

  file(relPath: string): SourceFile | undefined {
    return this.byPath.get(relPath);
  }

  imports(source: SourceFile): ImportRef[] {
    let cached = this.importsCache.get(source.path);
    if (!cached) {
      cached = parseImports(source.text);
      this.importsCache.set(source.path, cached);
    }
    return cached;
  }

  /** Resolves a specifier from `fromFile` to a project file, or null if external. */
  resolve(fromFile: string, specifier: string): SourceFile | null {
    const candidates: string[] = [];

    if (specifier.startsWith(".")) {
      candidates.push(toPosix(path.posix.join(path.posix.dirname(fromFile), specifier)));
    } else if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
      const rest = specifier.slice(2);
      for (const root of this.aliasRoots) {
        candidates.push(root === "." ? rest : `${root}/${rest}`);
      }
    } else {
      return null; // bare package specifier
    }

    for (const base of candidates) {
      const direct = this.byPath.get(base);
      if (direct) return direct;
      for (const ext of SOURCE_EXTENSIONS) {
        const withExt = this.byPath.get(`${base}.${ext}`);
        if (withExt) return withExt;
      }
      for (const ext of SOURCE_EXTENSIONS) {
        const index = this.byPath.get(`${base}/index.${ext}`);
        if (index) return index;
      }
      // ESM style ".js" specifier pointing at a TypeScript source
      const swapped = base.replace(/\.(js|mjs|cjs)$/, "");
      if (swapped !== base) {
        for (const ext of SOURCE_EXTENSIONS) {
          const hit = this.byPath.get(`${swapped}.${ext}`);
          if (hit) return hit;
        }
      }
    }

    return null;
  }

  /**
   * Walks the local import graph from `entry` and returns the first file whose
   * imports match `predicate`, along with the path taken to reach it.
   */
  findReachable(
    entry: SourceFile,
    predicate: (file: SourceFile, imp: ImportRef) => boolean,
    maxDepth = 6,
  ): { file: SourceFile; imp: ImportRef; chain: string[] } | null {
    const seen = new Set<string>([entry.path]);
    const queue: Array<{ file: SourceFile; depth: number; chain: string[] }> = [
      { file: entry, depth: 0, chain: [entry.path] },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const imp of this.imports(current.file)) {
        if (predicate(current.file, imp)) {
          return { file: current.file, imp, chain: current.chain };
        }
        if (current.depth >= maxDepth) continue;
        const target = this.resolve(current.file.path, imp.specifier);
        if (!target || seen.has(target.path)) continue;
        // A "use client" boundary is where the client bundle starts, so keep going.
        seen.add(target.path);
        queue.push({ file: target, depth: current.depth + 1, chain: [...current.chain, target.path] });
      }
    }

    return null;
  }
}
