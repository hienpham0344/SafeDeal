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
        command: "npx vite --host 127.0.0.1 --port 4173 --strictPort",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 30_000,
        env: {
          ...process.env,
          VITE_APP_NAME: "SafeDeal",
          VITE_APP_ENV: "test",
          VITE_API_BASE_URL: "http://localhost:8080",
          VITE_CHAIN_ID: "31337",
          VITE_CHAIN_NAME: "Anvil Local",
          VITE_RPC_URL: "http://127.0.0.1:8545",
          VITE_EXPLORER_BASE_URL: "",
          VITE_ESCROW_CONTRACT_ADDRESS: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
          VITE_DEFAULT_ARBITER_ADDRESS: "",
        },
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
