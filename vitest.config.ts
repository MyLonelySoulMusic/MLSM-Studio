import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["apps/desktop/src/**/*.{ts,tsx}", "packages/*/src/**/*.ts"],
      exclude: ["**/*.test.{ts,tsx}", "**/main.tsx", "**/*.worker.ts", "**/*.d.ts", "**/components/Viewport.tsx"],
      thresholds: { statements: 50, branches: 40, functions: 30, lines: 50 }
    }
  }
});
