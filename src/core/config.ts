import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import type { NextDocConfig } from "./types.js";
import { NextDocError, EXIT } from "./exit-codes.js";
import { stripBom } from "./scan.js";

export const CONFIG_FILENAMES = [
  "next-doc.config.json",
  "next-doc.config.js",
  "next-doc.config.mjs",
  "next-doc.config.cjs",
  "next-doc.config.ts",
] as const;

const pluginName = z.enum(["env", "security", "performance", "idempotency"]);
const ruleLevel = z.enum(["off", "warn", "error"]);
const envType = z.enum(["string", "url", "number", "boolean", "email"]);

/**
 * Strict by construction: unknown keys are rejected rather than silently
 * ignored, so a typo in a config file is a loud error instead of a check that
 * quietly never runs.
 */
export const configSchema = z
  .object({
    $schema: z.string().optional(),
    plugins: z.array(pluginName).nonempty().optional(),
    ignore: z.array(z.string()).optional(),
    strict: z.boolean().optional(),
    rules: z.record(ruleLevel).optional(),
    env: z
      .object({
        required: z.array(z.string()).optional(),
        optional: z.array(z.string()).optional(),
        types: z.record(envType).optional(),
        allowPublic: z.array(z.string()).optional(),
        files: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    security: z
      .object({
        requiredHeaders: z.array(z.string()).optional(),
        headerFiles: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    performance: z
      .object({
        maxRouteKb: z.number().positive().optional(),
        maxClientComponentKb: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    idempotency: z
      .object({
        pathPatterns: z.array(z.string()).optional(),
        keywords: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type UserConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: NextDocConfig = {
  plugins: ["env", "security", "performance", "idempotency"],
  ignore: [
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.turbo/**",
    "**/*.d.ts",
  ],
  strict: false,
  rules: {},
  env: {
    required: [],
    optional: [],
    types: {},
    allowPublic: [],
    files: [".env", ".env.local", ".env.example", ".env.development", ".env.production"],
  },
  security: {
    requiredHeaders: [
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Strict-Transport-Security",
    ],
    headerFiles: [],
  },
  performance: {
    maxRouteKb: 250,
    maxClientComponentKb: 100,
  },
  idempotency: {
    pathPatterns: [
      "payment",
      "payments",
      "checkout",
      "subscription",
      "subscriptions",
      "webhook",
      "webhooks",
      "charge",
      "charges",
      "refund",
      "refunds",
      "order",
      "orders",
      "invoice",
      "billing",
      "transfer",
      "payout",
    ],
    keywords: ["idempotencyKey", "idempotency_key", "Idempotency-Key", "withIdempotency", "dedupe", "deduplicate"],
  },
};

function merge(base: NextDocConfig, user: UserConfig): NextDocConfig {
  return {
    plugins: user.plugins ?? base.plugins,
    ignore: user.ignore ? [...base.ignore, ...user.ignore] : base.ignore,
    strict: user.strict ?? base.strict,
    rules: { ...base.rules, ...(user.rules ?? {}) },
    env: {
      required: user.env?.required ?? base.env.required,
      optional: user.env?.optional ?? base.env.optional,
      types: { ...base.env.types, ...(user.env?.types ?? {}) },
      allowPublic: user.env?.allowPublic ?? base.env.allowPublic,
      files: user.env?.files ?? base.env.files,
    },
    security: {
      requiredHeaders: user.security?.requiredHeaders ?? base.security.requiredHeaders,
      headerFiles: user.security?.headerFiles ?? base.security.headerFiles,
    },
    performance: {
      maxRouteKb: user.performance?.maxRouteKb ?? base.performance.maxRouteKb,
      maxClientComponentKb: user.performance?.maxClientComponentKb ?? base.performance.maxClientComponentKb,
    },
    idempotency: {
      pathPatterns: user.idempotency?.pathPatterns ?? base.idempotency.pathPatterns,
      keywords: user.idempotency?.keywords
        ? [...base.idempotency.keywords, ...user.idempotency.keywords]
        : base.idempotency.keywords,
    },
  };
}

async function findConfigFile(cwd: string): Promise<string | null> {
  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(cwd, name);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

async function readConfigFile(file: string): Promise<unknown> {
  if (file.endsWith(".json")) {
    const raw = stripBom(await fs.readFile(file, "utf8"));
    try {
      return JSON.parse(raw) as unknown;
    } catch (err) {
      throw new NextDocError(
        `Config file is not valid JSON: ${file}`,
        EXIT.CONFIG,
        (err as Error).message,
      );
    }
  }

  try {
    const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
    return mod.default ?? mod;
  } catch (err) {
    if (file.endsWith(".ts")) {
      throw new NextDocError(
        `Could not load ${path.basename(file)}. Node cannot import TypeScript directly.`,
        EXIT.CONFIG,
        "Use next-doc.config.json, or run the CLI through a TypeScript loader such as tsx.",
      );
    }
    throw new NextDocError(`Could not load config file: ${file}`, EXIT.CONFIG, (err as Error).message);
  }
}

export interface LoadConfigResult {
  config: NextDocConfig;
  /** Absolute path of the file used, null when defaults were used. */
  sourcePath: string | null;
}

export async function loadConfig(cwd: string, explicitPath?: string): Promise<LoadConfigResult> {
  let file: string | null;

  if (explicitPath) {
    file = path.isAbsolute(explicitPath) ? explicitPath : path.join(cwd, explicitPath);
    try {
      await fs.access(file);
    } catch {
      throw new NextDocError(`Config file not found: ${explicitPath}`, EXIT.CONFIG);
    }
  } else {
    file = await findConfigFile(cwd);
  }

  if (!file) return { config: DEFAULT_CONFIG, sourcePath: null };

  const raw = await readConfigFile(file);
  const parsed = configSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new NextDocError(
      `Invalid config in ${path.basename(file)}`,
      EXIT.CONFIG,
      `${details}\n\nSee the schema reference: docs/02-configuration.md`,
    );
  }

  return { config: merge(DEFAULT_CONFIG, parsed.data), sourcePath: file };
}

/** Config written by `next-doc init`. */
export function initialConfig(): UserConfig {
  return {
    $schema: "https://unpkg.com/@wamasoda/next-doc/schema.json",
    plugins: ["env", "security", "performance", "idempotency"],
    ignore: ["**/node_modules/**", "**/.next/**"],
    strict: false,
    rules: {},
    env: {
      required: [],
      types: {},
      allowPublic: [],
    },
  };
}
