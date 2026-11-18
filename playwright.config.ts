import { defineConfig, devices } from "@playwright/test";

export const MOCK_SERVER = "https://mock.happy.test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm build && pnpm preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    env: { VITE_HAPPY_SERVER_URL: MOCK_SERVER },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
