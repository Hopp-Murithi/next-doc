import type { Finding, Rule, ScanContext, SourceFile } from "../../../core/types.js";
import { finding } from "../../../core/plugin.js";
import { ModuleGraph } from "../../../core/module-graph.js";

/** Node builtins that cannot run in a browser and usually mean server code. */
const NODE_BUILTINS = [
  "fs",
  "fs/promises",
  "child_process",
  "net",
  "dns",
  "tls",
  "cluster",
  "worker_threads",
  "http",
  "https",
  "os",
  "v8",
  "vm",
];

/** Packages whose presence in a client bundle usually leaks a credential. */
const SERVER_PACKAGES = [
  "server-only",
  "pg",
  "mysql",
  "mysql2",
  "mongodb",
  "mongoose",
  "ioredis",
  "redis",
  "@prisma/client",
  "drizzle-orm/node-postgres",
  "drizzle-orm/postgres-js",
  "nodemailer",
  "bcrypt",
  "bcryptjs",
  "argon2",
  "jsonwebtoken",
  "firebase-admin",
  "@sendgrid/mail",
  "resend",
  "stripe",
  "@aws-sdk/client-s3",
  "@aws-sdk/client-secrets-manager",
  "googleapis",
];

function isServerSpecifier(spec: string): string | null {
  const bare = spec.replace(/^node:/, "");
  if (spec.startsWith("node:") || NODE_BUILTINS.includes(bare)) {
    return NODE_BUILTINS.includes(bare) ? `Node builtin "${bare}"` : `Node builtin "${bare}"`;
  }
  for (const pkg of SERVER_PACKAGES) {
    if (spec === pkg || spec.startsWith(`${pkg}/`)) return `server package "${pkg}"`;
  }
  return null;
}

function clientEntries(ctx: ScanContext, graph: ModuleGraph): SourceFile[] {
  if (ctx.framework.isNext) {
    return graph.files.filter((f) => f.isClient);
  }
  // In a client rendered React app every module under the source dirs ends up
  // in the browser bundle, so the whole app is the client boundary. Config
  // files, server entry points and API folders are excluded.
  return graph.files.filter(
    (f) =>
      !/\.config\.[cm]?[jt]sx?$/.test(f.path) &&
      !/(^|\/)(server|api|scripts?|functions|netlify|migrations)\//.test(f.path) &&
      !/\.server\.[cm]?[jt]sx?$/.test(f.path) &&
      !/(^|\/)(vite|next|tailwind|postcss|eslint|jest|vitest)\./.test(f.path),
  );
}

/**
 * The one check where following imports genuinely beats pattern matching: the
 * leak is rarely a direct import, it is a client component importing a helper
 * that imports the database client three files down.
 */
export const serverOnlyInClient: Rule = {
  code: "SECURITY_SERVER_CODE_IN_CLIENT",
  title: "Server only modules stay out of client components",
  async run(ctx: ScanContext): Promise<Finding[]> {
    const graph = await ModuleGraph.create(ctx);
    const entries = clientEntries(ctx, graph);
    if (entries.length === 0) return [];

    const findings: Finding[] = [];

    for (const entry of entries) {
      const hit = graph.findReachable(entry, (_file, imp) => isServerSpecifier(imp.specifier) !== null);
      if (!hit) continue;

      const label = isServerSpecifier(hit.imp.specifier)!;
      const direct = hit.file.path === entry.path;
      const chain = direct ? "" : ` through ${hit.chain.slice(1).join(" -> ")}`;

      findings.push(
        finding.error({
          code: "SECURITY_SERVER_CODE_IN_CLIENT",
          message: ctx.framework.isNext
            ? `Client component ${entry.path} pulls in ${label}${chain}`
            : `${entry.path} ships ${label} to the browser${chain}`,
          file: direct ? entry.path : hit.file.path,
          line: hit.imp.line,
          fixable: false,
          suggestion: ctx.framework.isNext
            ? "Move this work into a Server Component, a Server Action, or a Route Handler, and pass the result down as props. Anything reachable from a use client file is compiled into the browser bundle."
            : "Move this work behind an API endpoint. Everything imported here is compiled into the browser bundle, including any credential the module reads.",
        }),
      );
    }

    if (findings.length === 0) {
      return [
        finding.pass({
          code: "SECURITY_SERVER_CODE_IN_CLIENT",
          message: `No server only modules reachable from ${entries.length} client file${entries.length === 1 ? "" : "s"}`,
        }),
      ];
    }

    return findings;
  },
};
