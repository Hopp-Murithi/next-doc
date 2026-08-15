import type { Finding, Rule, ScanContext, SourceFile } from "../../../core/types.js";
import { finding } from "../../../core/plugin.js";
import { lineAt } from "../../../core/scan.js";

interface HandlerHit {
  kind: string;
  index: number;
}

/** Mutation entry points across the frameworks this tool supports. */
const HANDLER_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: "Route Handler", re: /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH)\b/g },
  { kind: "Route Handler", re: /export\s+const\s+(?:POST|PUT|PATCH)\s*=/g },
  { kind: "action", re: /export\s+(?:async\s+)?function\s+action\b/g },
  { kind: "action", re: /export\s+const\s+action\s*[:=]/g },
  { kind: "Express route", re: /\b(?:app|router)\.(?:post|put|patch)\s*\(/g },
  { kind: "API route", re: /export\s+default\s+(?:async\s+)?function\s+handler\b/g },
];

function findHandlers(file: SourceFile): HandlerHit[] {
  const hits: HandlerHit[] = [];
  for (const { kind, re } of HANDLER_PATTERNS) {
    const rx = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = rx.exec(file.text)) !== null) {
      hits.push({ kind, index: m.index });
    }
  }
  if (file.isServerAction && hits.length === 0) {
    const rx = /export\s+async\s+function\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(file.text)) !== null) {
      hits.push({ kind: "Server Action", index: m.index });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

function matchesMoneyPath(filePath: string, patterns: string[]): string | null {
  const lower = filePath.toLowerCase();
  for (const pattern of patterns) {
    const p = pattern.toLowerCase();
    if (lower.includes(`/${p}/`) || lower.includes(`/${p}.`) || lower.includes(`${p}-`) || lower.startsWith(p)) {
      return pattern;
    }
  }
  return null;
}

/**
 * A heuristic, and the wording says so. It looks at path names and at whether
 * any idempotency concept appears in the file. It cannot prove a handler is
 * unprotected, so it reports a possibility and points at the fix.
 *
 * Suppress a false positive with `// nextdoc-ignore idempotency` on the
 * handler line or the line above it.
 */
export const unprotectedMutationRoute: Rule = {
  code: "IDEM_UNPROTECTED_ROUTE",
  title: "Money handling routes are idempotent",
  async run(ctx: ScanContext): Promise<Finding[]> {
    const sources = await ctx.files.sources();
    const { pathPatterns, keywords } = ctx.config.idempotency;
    const findings: Finding[] = [];
    let scanned = 0;

    for (const file of sources) {
      if (file.isClient) continue;
      if (TEST_PATH.test(file.path)) continue;
      const matched = matchesMoneyPath(file.path, pathPatterns);
      if (!matched) continue;

      const handlers = findHandlers(file);
      if (handlers.length === 0) continue;
      scanned++;

      const protectedByKeyword = keywords.some((keyword) =>
        new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(file.text),
      );
      if (protectedByKeyword) continue;

      const first = handlers[0]!;
      findings.push(
        finding.error({
          code: "IDEM_UNPROTECTED_ROUTE",
          message: `${file.path} has no idempotency key handling detected, possible missing idempotency protection`,
          file: file.path,
          line: lineAt(file.text, first.index),
          fixable: false,
          suggestion:
            "Wrap the handler with withIdempotency from @wamasoda/nextdoc/idempotency, or read an Idempotency-Key header and deduplicate yourself. A retried request here can charge a customer twice.",
        }),
      );
    }

    if (findings.length === 0) {
      return [
        finding.pass({
          code: "IDEM_UNPROTECTED_ROUTE",
          message:
            scanned > 0
              ? `All ${scanned} money handling route${scanned === 1 ? "" : "s"} handle idempotency`
              : "No unprotected payment or webhook mutations found",
        }),
      ];
    }

    return findings;
  },
};

/**
 * A key read from the request is only half the job. Reading it and never
 * storing it deduplicates nothing, so this rule looks for storage nearby.
 */
/** Tests name and pass idempotency keys constantly. That is not a finding. */
const TEST_PATH = /(^|\/)(__tests__|__mocks__|tests?|e2e|cypress|playwright|spec|fixtures?)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/;

export const keyReadButNotStored: Rule = {
  code: "IDEM_KEY_NOT_PERSISTED",
  title: "Idempotency keys are actually persisted",
  async run(ctx: ScanContext): Promise<Finding[]> {
    const sources = await ctx.files.sources();
    const findings: Finding[] = [];

    const readsKey = /["']idempotency[-_]?key["']|idempotencyKey/i;
    const persists =
      /withIdempotency|\.set\s*\(|\.setnx|setNX|INSERT\s+INTO|upsert|create\s*\(|redis|kv\.|cache\.|prisma\.|db\./i;

    for (const file of sources) {
      if (file.isClient) continue;
      if (TEST_PATH.test(file.path)) continue;
      if (!readsKey.test(file.text)) continue;
      if (persists.test(file.text)) continue;

      findings.push(
        finding.warn({
          code: "IDEM_KEY_NOT_PERSISTED",
          message: `${file.path} reads an idempotency key but never stores it, so duplicate requests are not detected`,
          file: file.path,
          line: 1,
          fixable: false,
          suggestion:
            "Store the key atomically before doing the work, for example with withIdempotency from @wamasoda/nextdoc/idempotency, or a SET NX in Redis, or a unique constraint in your database.",
        }),
      );
    }

    return findings;
  },
};
