import { defineConfig, devices } from "@playwright/test";

/** Browser tests for the static UI: the eval report and the Playground's offline state. No keys, no agent. */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // Locally, use the installed Chrome instead of downloading a browser; CI installs Chromium.
  use: { baseURL: "http://127.0.0.1:4173", ...(process.env.CI ? {} : { channel: "chrome" }) },
  webServer: {
    command: "pnpm build && pnpm exec vite preview web --port 4173 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
