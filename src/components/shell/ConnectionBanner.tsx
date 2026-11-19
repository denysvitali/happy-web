import { CloudOff, Check, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useAccount } from "@/app/auth";
import { useStore } from "@/app/hooks";
import { troubleOf, useBrowserOnline, type Trouble } from "./connection";
import classes from "./connection-banner.module.css";

export type BannerKind = Trouble | "restored";

const TEXT: Record<BannerKind, string> = { offline: "You're offline", reconnecting: "Reconnecting…", restored: "Back online" };
/** Brief blips (a socket cycling, first connect) stay silent. */
const SHOW_AFTER_MS = 800;
const RESTORED_MS = 2200;

/**
 * Slim strip above the content while realtime updates are down. Waits a beat
 * before appearing, turns into "Back online" when the link returns, then
 * folds away. Always mounted so the live region announces every change.
 */
export function ConnectionBanner() {
  const socket = useStore(useAccount().status);
  const browserOnline = useBrowserOnline();
  const trouble = troubleOf(browserOnline, socket);
  const [open, setOpen] = useState(false);
  const [restored, setRestored] = useState(false);

  // Adjust during render (not in an effect): trouble ending while the strip is up means "restored".
  const [prev, setPrev] = useState(trouble);
  if (prev !== trouble) {
    setPrev(trouble);
    setRestored(trouble === null && open);
  }
  const kind: BannerKind | null = trouble ?? (restored ? "restored" : null);

  useEffect(() => {
    if (trouble && !open) {
      const t = setTimeout(() => setOpen(true), SHOW_AFTER_MS);
      return () => clearTimeout(t);
    }
    if (!trouble && restored && open) {
      const t = setTimeout(() => setOpen(false), RESTORED_MS);
      return () => clearTimeout(t);
    }
  }, [trouble, open, restored]);

  return <ConnectionStrip kind={kind} open={open} />;
}

/** The strip itself (presentational; also used by the components demo). Always render it so the live region announces changes. */
export function ConnectionStrip({ kind, open }: { kind: BannerKind | null; open: boolean }) {
  const Icon = kind === "offline" ? CloudOff : kind === "restored" ? Check : RefreshCw;
  return (
    <div className={classes.root} data-open={open || undefined} data-kind={kind ?? undefined} role="status" aria-live="polite">
      <div className={classes.clip}>
        <div className={classes.bar}>
          {kind && <Icon className={classes.icon} size={13} strokeWidth={2.5} aria-hidden />}
          <span>{kind ? TEXT[kind] : ""}</span>
        </div>
      </div>
    </div>
  );
}
