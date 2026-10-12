import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [{ test: { name: "node", include: ["test/**/*.test.ts"] } }, "web/vite.config.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/cli/**"],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
