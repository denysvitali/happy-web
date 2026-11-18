import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { getServerUrl } from "./lib/config";
import { narrowConnectSrc } from "./lib/csp";
import "./index.css";

// Must run before any network access (module evaluation of App opens none).
narrowConnectSrc(getServerUrl());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
