import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { MOCK_SERVER } from "./e2e/mock";

// Rootless Chromium deps unpacked by scripts/e2e-setup.sh (same path there).
const browserDeps = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "happy-web/chromium-deps");
if (existsSync(browserDeps)) {
  const ld = process.env.LD_LIBRARY_PATH;
  process.env.LD_LIBRARY_PATH = join(browserDeps, "lib") + (ld ? `:${ld}` : "");
  process.env.FONTCONFIG_FILE = join(browserDeps, "fonts.conf");
}

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
