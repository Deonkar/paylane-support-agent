import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  base: "./", // works both from the local server and from a GitHub Pages sub-path
  publicDir: "../eval/results", // ships report.json with the static report
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
  test: { environment: "jsdom", include: ["src/**/*.test.tsx"] },
});
