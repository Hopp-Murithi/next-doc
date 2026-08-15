/**
 * Public contract shared by every plugin and by the --json output.
 *
 * `code` values are a public API. CI pipelines allowlist them and the docs link
 * to them, so renaming one is a breaking change.
 */

export type Severity = "error" | "warning" | "pass";

export interface Finding {
  severity: Severity;
  /** Stable machine readable id, e.g. "ENV_MISSING_VAR". */
  code: string;
  message: string;
  /** Path relative to the project root, POSIX separators. */
  file?: string;
  line?: number;
  fixable: boolean;
  /** Every error and warning must carry one. Enforced by a test. */
  suggestion?: string;
}

export interface PluginResult {
  plugin: PluginName;
  findings: Finding[];
  /** 0 to 100, contributes to the overall score. */
  score: number;
  /** Set when a plugin could only run part of its rule set. */
  notes?: string[];
}

export type PluginName = "env" | "security" | "performance" | "idempotency";

export type FrameworkName =
  | "next"
  | "vite"
  | "cra"
  | "remix"
  | "react-router"
  | "astro"
  | "react"
  | "unknown";

export interface FrameworkInfo {
  name: FrameworkName;
  /** Human label used in the report header, e.g. "Next.js 15.1.0". */
  label: string;
  version: string | null;
  reactVersion: string | null;
  typescript: boolean;
  /** App Router, Pages Router, both, or a client rendered SPA. */
  router: "app" | "pages" | "mixed" | "spa" | "none";
  /** Prefixes that expose a variable to the browser bundle. */
  publicEnvPrefixes: string[];
  /** Directories that hold application source, relative and POSIX. */
  sourceDirs: string[];
  /** Build output directories checked by the performance plugin. */
  buildDirs: string[];
  /** Absolute path to the framework config file, when one exists. */
  configPath: string | null;
  isNext: boolean;
  /** True for any supported React based project, including Next.js. */
  isReact: boolean;
  /** True when the framework runs server code we can audit (Next, Remix). */
  hasServerRuntime: boolean;
}

export interface PackageJsonLike {
  name?: string;
  version?: string;
  private?: boolean;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export interface SourceFile {
  /** POSIX path relative to cwd. */
  path: string;
  absPath: string;
  text: string;
  /** True when the file starts with a "use client" directive. */
  isClient: boolean;
  /** True when the file starts with a "use server" directive. */
  isServerAction: boolean;
}

export interface ScanContext {
  cwd: string;
  framework: FrameworkInfo;
  config: NextDocConfig;
  pkg: PackageJsonLike | null;
  /** --fix was passed. */
  fix: boolean;
  /** Lazily built, cached view of the project's files. */
  files: FileIndex;
  /** Collected by rules that write files, reported at the end of the run. */
  fixes: AppliedFix[];
}

export interface FileIndex {
  /** All application source files (ts, tsx, js, jsx, mjs, cjs). */
  sources(): Promise<SourceFile[]>;
  /** Glob relative to cwd, honouring the ignore config. */
  glob(patterns: string[]): Promise<string[]>;
  /** Read a file relative to cwd, null when missing. */
  read(relPath: string): Promise<string | null>;
  exists(relPath: string): Promise<boolean>;
}

export interface AppliedFix {
  file: string;
  code: string;
  description: string;
}

export interface Rule {
  code: string;
  /** Short human title, used in --markdown headings. */
  title: string;
  /** Skip the rule entirely for this project, e.g. Next only rules on Vite. */
  appliesTo?(ctx: ScanContext): boolean;
  run(ctx: ScanContext): Promise<Finding[]> | Finding[];
}

export interface NextDocPlugin {
  name: PluginName;
  description: string;
  rules: Rule[];
}

/** Parsed and validated next-doc.config.json. See src/core/config.ts. */
export interface NextDocConfig {
  plugins: PluginName[];
  ignore: string[];
  strict: boolean;
  rules: Record<string, "off" | "warn" | "error">;
  env: {
    required: string[];
    optional: string[];
    types: Record<string, "string" | "url" | "number" | "boolean" | "email">;
    allowPublic: string[];
    files: string[];
  };
  security: {
    requiredHeaders: string[];
    headerFiles: string[];
  };
  performance: {
    maxRouteKb: number;
    maxClientComponentKb: number;
  };
  idempotency: {
    pathPatterns: string[];
    keywords: string[];
  };
}

export interface RunReport {
  schemaVersion: 1;
  tool: { name: string; version: string };
  project: {
    cwd: string;
    framework: FrameworkName;
    frameworkLabel: string;
    router: FrameworkInfo["router"];
    typescript: boolean;
  };
  results: PluginResult[];
  summary: {
    errors: number;
    warnings: number;
    passed: number;
    fixable: number;
    fixesApplied: number;
    score: number;
  };
  /** Present when --fix ran. */
  fixes?: AppliedFix[];
}
