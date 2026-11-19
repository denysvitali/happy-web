import { RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { useUpdateAvailable } from "@/app/version";
import classes from "./shell.module.css";

/** A floating pill offering to load a newer deployed build. */
export function UpdatePrompt() {
  const available = useUpdateAvailable();
  const [dismissed, setDismissed] = useState(false);
  if (!available || dismissed) return null;
  return (
    <div className={classes.update} role="status">
      <button type="button" className={classes.updateReload} onClick={() => window.location.reload()}>
        <RefreshCw size={14} strokeWidth={2.25} />
        New version available · <strong>Reload</strong>
      </button>
      <button type="button" className={classes.updateDismiss} onClick={() => setDismissed(true)} aria-label="Dismiss">
        <X size={14} strokeWidth={2.25} />
      </button>
    </div>
  );
}
