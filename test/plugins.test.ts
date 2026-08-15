import { describe, expect, it } from "vitest";
import { findingsOf, hasCode, passedCode, scan } from "./helpers.js";

describe("env plugin", () => {
  it("flags a browser exposed secret, drift and unused variables in a broken Next.js app", async () => {
    const result = await scan("next-bad", ["env"]);
    const findings = findingsOf(result, "env");

    expect(hasCode(findings, "ENV_PUBLIC_SECRET")).toBe(true);
    expect(hasCode(findings, "ENV_EXAMPLE_MISSING")).toBe(true);
    expect(hasCode(findings, "ENV_UNUSED_VAR")).toBe(true);
    expect(hasCode(findings, "ENV_MISSING_VAR")).toBe(true);
  });

  it("stays quiet on a clean Next.js app", async () => {
    const result = await scan("next-clean", ["env"]);
    const findings = findingsOf(result, "env");

    expect(hasCode(findings, "ENV_PUBLIC_SECRET")).toBe(false);
    expect(hasCode(findings, "ENV_FILE_DRIFT")).toBe(false);
    expect(passedCode(findings, "ENV_PUBLIC_SECRET")).toBe(true);
  });

  it("uses the right public prefix for a React project on Vite", async () => {
    const result = await scan("vite-react", ["env"]);
    const findings = findingsOf(result, "env");
    const leak = findings.find((f) => f.code === "ENV_PUBLIC_SECRET" && f.severity === "error");

    expect(leak?.message).toContain("VITE_SENDGRID_API_KEY");
    expect(leak?.suggestion).toContain("VITE_");
    // A Google Analytics id matches a known public value shape, so it is not a leak.
    expect(findings.some((f) => f.message.includes("VITE_ANALYTICS_ID") && f.severity === "error")).toBe(false);
  });

  it("reads import.meta.env references, not just process.env", async () => {
    const result = await scan("vite-react", ["env"]);
    const findings = findingsOf(result, "env");
    expect(findings.some((f) => f.message.includes("VITE_FEATURE_FLAGS"))).toBe(true);
  });
});

describe("security plugin", () => {
  it("finds missing headers, an unverified webhook, an open redirect and a leaked server import", async () => {
    const result = await scan("next-bad", ["security"]);
    const findings = findingsOf(result, "security");

    expect(hasCode(findings, "SECURITY_MISSING_HEADER")).toBe(true);
    expect(hasCode(findings, "SECURITY_NO_CSP")).toBe(true);
    expect(hasCode(findings, "SECURITY_WEBHOOK_UNVERIFIED")).toBe(true);
    expect(hasCode(findings, "SECURITY_UNSAFE_REDIRECT")).toBe(true);
    expect(hasCode(findings, "SECURITY_MISSING_CSRF")).toBe(true);
  });

  it("follows the import chain from a client component to a database client", async () => {
    const result = await scan("next-bad", ["security"]);
    const findings = findingsOf(result, "security");
    const leak = findings.find((f) => f.code === "SECURITY_SERVER_CODE_IN_CLIENT");

    expect(leak?.severity).toBe("error");
    expect(leak?.message).toContain("ProfileForm.tsx");
    expect(leak?.message).toContain("pg");
    // The chain matters: the import is two files away, not in the client file.
    expect(leak?.message).toContain("src/lib/data.ts");
  });

  it("passes a hardened Next.js config", async () => {
    const result = await scan("next-clean", ["security"]);
    const findings = findingsOf(result, "security");

    expect(passedCode(findings, "SECURITY_MISSING_HEADER")).toBe(true);
    expect(passedCode(findings, "SECURITY_NO_CSP")).toBe(true);
    expect(hasCode(findings, "SECURITY_SERVER_CODE_IN_CLIENT")).toBe(false);
  });

  it("does not run Next.js only rules against a React SPA", async () => {
    const result = await scan("vite-react", ["security"]);
    const findings = findingsOf(result, "security");
    expect(findings.some((f) => f.code === "SECURITY_MISSING_CSRF")).toBe(false);
  });
});

describe("performance plugin", () => {
  it("reports the missing build output instead of guessing a bundle size", async () => {
    const result = await scan("next-bad", ["performance"]);
    const findings = findingsOf(result, "performance");
    const note = findings.find((f) => f.code === "PERF_NO_BUILD_OUTPUT");

    expect(note).toBeDefined();
    expect(note?.suggestion).toContain("next build");
    expect(hasCode(findings, "PERF_LARGE_ROUTE")).toBe(false);
  });

  it("flags a client component with no interactivity, a raw img and an uncached fetch", async () => {
    const result = await scan("next-bad", ["performance"]);
    const findings = findingsOf(result, "performance");

    expect(hasCode(findings, "PERF_UNNECESSARY_USE_CLIENT")).toBe(true);
    expect(hasCode(findings, "PERF_UNOPTIMIZED_IMAGE")).toBe(true);
    expect(hasCode(findings, "PERF_UNCACHED_FETCH")).toBe(true);
    expect(hasCode(findings, "PERF_FONT_LOADING")).toBe(true);
    expect(hasCode(findings, "PERF_DUPLICATE_DEPS")).toBe(true);
  });

  it("accepts next/image, next/font and an explicit revalidate", async () => {
    const result = await scan("next-clean", ["performance"]);
    const findings = findingsOf(result, "performance");

    expect(hasCode(findings, "PERF_UNOPTIMIZED_IMAGE")).toBe(false);
    expect(hasCode(findings, "PERF_UNCACHED_FETCH")).toBe(false);
    expect(hasCode(findings, "PERF_FONT_LOADING")).toBe(false);
  });

  it("checks image dimensions rather than next/image in a plain React app", async () => {
    const result = await scan("vite-react", ["performance"]);
    const findings = findingsOf(result, "performance");
    const image = findings.find((f) => f.code === "PERF_UNOPTIMIZED_IMAGE");

    expect(image?.message).toContain("width and height");
    expect(image?.message).not.toContain("next/image");
  });

  it("never offers a fix, because nothing here is safely automatable", async () => {
    const result = await scan("next-bad", ["performance"]);
    const findings = findingsOf(result, "performance");
    expect(findings.every((f) => f.fixable === false)).toBe(true);
  });
});

describe("idempotency plugin", () => {
  it("flags an unprotected payment route and words it as a possibility", async () => {
    const result = await scan("next-bad", ["idempotency"]);
    const findings = findingsOf(result, "idempotency");
    const payment = findings.find((f) => f.file === "app/api/payments/route.ts");

    expect(payment?.severity).toBe("error");
    expect(payment?.message).toContain("possible missing idempotency protection");
    expect(payment?.suggestion).toContain("withIdempotency");
  });

  it("recognises a route already wrapped with withIdempotency", async () => {
    const result = await scan("next-clean", ["idempotency"]);
    const findings = findingsOf(result, "idempotency");

    expect(hasCode(findings, "IDEM_UNPROTECTED_ROUTE")).toBe(false);
    expect(passedCode(findings, "IDEM_UNPROTECTED_ROUTE")).toBe(true);
  });

  it("ignores routes that do not handle money", async () => {
    const result = await scan("next-bad", ["idempotency"]);
    const findings = findingsOf(result, "idempotency");
    expect(findings.some((f) => f.file === "app/api/session/route.ts")).toBe(false);
  });
});
