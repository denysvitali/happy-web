import { defineConfig, devices } from "@playwright/test";

import { MOCK_SERVER } from "./e2e/mock";

// E2E_PORT lets parallel checkouts (worktrees) run their own preview server.
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `${process.env.E2E_SKIP_BUILD ? "" : "pnpm build && "}pnpm preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    env: { VITE_HAPPY_SERVER_URL: MOCK_SERVER },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
