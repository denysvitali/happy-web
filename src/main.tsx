import "@mantine/core/styles.layer.css";
import "@mantine/notifications/styles.layer.css";
import "./ui/tokens.css";
import "./app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { getServerUrl } from "./lib/config";
import { narrowConnectSrc } from "./lib/csp";

// Must run before any network access (module evaluation of App opens none).
narrowConnectSrc(getServerUrl());

// `happy auth login --method web` opens <webapp>/terminal/connect#key=…, but
// routes live in the hash: move it to #/terminal/connect?key=… (routes/connect.tsx).
if (/\/terminal\/connect\/?$/.test(location.pathname) && location.hash.startsWith("#key=")) {
  history.replaceState(null, "", `${import.meta.env.BASE_URL}#/terminal/connect?${location.hash.slice(1)}`);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
