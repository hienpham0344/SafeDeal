import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const envChromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const executablePath =
  envChromiumPath !== undefined
    ? envChromiumPath.trim() || undefined
    : existsSync("/usr/bin/google-chrome")
      ? "/usr/bin/google-chrome"
      : undefined;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
  use: {
    baseURL,
    launchOptions: executablePath
      ? {
          executablePath,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        }
      : {
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        },
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } },
    },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
});
