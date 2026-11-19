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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
