import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";

// The static CSP allows only https/wss connections; at startup the app adds a
// second, narrower policy for the configured server origin (src/lib/csp.ts).
function csp(dev: boolean): Plugin {
  const connect = dev ? "'self' ws: wss: http: https:" : "'self' https: wss:";
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "happy-csp",
    transformIndexHtml: (html) => html.replace("%HAPPY_CSP%", policy),
  };
}

// One id per build: the commit in CI, else the build time. Baked into the
// bundle and written to version.json, which open tabs poll to offer a reload
// once a newer build is deployed (src/app/version.ts).
const BUILD_ID = process.env.GITHUB_SHA ?? String(Date.now());

function version(): Plugin {
  return {
    name: "happy-version",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

// Static hosts (GitHub Pages) have no SPA fallback, so the page a terminal's
// `happy auth login --method web` opens (<base>terminal/connect) gets its own
// copy of index.html; main.tsx moves the key into the hash route.
function terminalConnect(): Plugin {
  return {
    name: "happy-terminal-connect",
    enforce: "post",
    apply: "build",
    generateBundle(_, bundle) {
      const index = bundle["index.html"];
      if (index?.type !== "asset") throw new Error("index.html missing from the bundle");
      this.emitFile({ type: "asset", fileName: "terminal/connect/index.html", source: index.source });
    },
  };
}

export default defineConfig(({ command }) => ({
  base: process.env.HAPPY_WEB_BASE ?? "/",
  plugins: [react(), csp(command === "serve"), version(), terminalConnect()],
  define: { __HAPPY_BUILD__: JSON.stringify(BUILD_ID) },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { target: "es2022", sourcemap: false, assetsInlineLimit: 0 },
  css: { modules: { localsConvention: "camelCaseOnly" } },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
}));
