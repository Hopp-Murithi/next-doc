import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/fixtures/**"],
    environment: "node",
    // Builds dist/cli.js first if it is missing, so the CLI tests never fail
    // for want of an artifact.
    globalSetup: ["./test/global-setup.ts"],
    // The CLI tests spawn a real node process per case. Process startup on a
    // loaded Windows machine or a shared CI runner can take seconds on its own,
    // so the default 5s budget produces flaky failures that are not bugs.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/plugins/**", "src/runtime/**", "src/core/**"],
      reporter: ["text", "lcov"],
    },
  },
});
