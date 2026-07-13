import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3210);
const baseURL = `http://127.0.0.1:${port}`;
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR ?? join(tmpdir(), "skyla-playwright-results");

export default defineConfig({
  testDir: "./e2e",
  outputDir,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: `bun run build && bun run start --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 500 },
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      CLERK_SECRET_KEY: "",
      CONVEX_URL: "",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
      NEXT_PUBLIC_CONVEX_URL: "",
      NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_CONVERSION: "",
      NEXT_PUBLIC_GOOGLE_ADS_TAG_ID: "",
      SKYLA_POS_TERMINAL_ACCEPTANCE: "",
      SKYLA_PUBLIC_ORIGIN: "https://skydeckla.com"
    }
  }
});
