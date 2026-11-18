import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";

// The static CSP allows only https/wss connections; at startup the app adds a
// second, narrower policy for the configured server origin (src/lib/csp.ts).
function csp(dev: boolean): Plugin {
  const connect = dev ? "'self' ws: wss: http: https:" : "https: wss:";
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

export default defineConfig(({ command }) => ({
  base: process.env.HAPPY_WEB_BASE ?? "/",
  plugins: [react(), tailwindcss(), csp(command === "serve")],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { target: "es2022", sourcemap: false, assetsInlineLimit: 0 },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
}));
