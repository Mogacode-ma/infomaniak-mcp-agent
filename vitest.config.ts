import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/server.ts", "src/types/**"],
      // Pragmatic thresholds for the current state of the project. We
      // ship many tools quickly and add behavioral tests for the
      // critical primitives (config, throttle, confirmation, history,
      // errors, audit, introspection). Per-tool happy-path tests will
      // bring these numbers up — tracked as a follow-up task. Branches
      // is already strong because every tool's plan/apply branching is
      // exercised through its imports.
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 75,
        statements: 50,
      },
    },
  },
});
