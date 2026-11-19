// Notices a newer deployed build: polls the version.json written next to the
// bundle (vite.config.ts) and compares it with the build this tab runs.
import { useEffect, useState } from "react";

const EVERY_MS = 5 * 60_000;

async function deployedBuild(): Promise<string | undefined> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: "no-store" });
    if (!r.ok) return undefined;
    const v = (await r.json()) as { build?: unknown };
    return typeof v.build === "string" ? v.build : undefined;
  } catch {
    return undefined; // offline or blocked: just try again later
  }
}

/** True once the server has a build other than the running one. Checks on
 * load, every few minutes, and whenever the tab becomes visible again. */
export function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV || available) return;
    let stopped = false;
    const check = async () => {
      const b = await deployedBuild();
      if (!stopped && b && b !== __HAPPY_BUILD__) setAvailable(true);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    const t = setInterval(() => void check(), EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [available]);
  return available;
}
