/**
 * Documented exit codes. CI steps branch on these, so treat them as a public API.
 * Mirrored in docs/04-ci-integration.md.
 */
export const EXIT = {
  /** No errors, or warnings only without --strict. */
  OK: 0,
  /** One or more errors found (or warnings with --strict). */
  FINDINGS: 1,
  /** Config file invalid, or not found when explicitly passed with --config. */
  CONFIG: 2,
  /** Not a supported project: no Next.js or React app detected. */
  NOT_A_PROJECT: 3,
  /** Internal or unexpected error. */
  INTERNAL: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export class NextDocError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "NextDocError";
  }
}
