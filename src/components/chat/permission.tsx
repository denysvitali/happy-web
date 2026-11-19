import { Button } from "@mantine/core";
import { ShieldQuestion, X } from "lucide-react";
import { useState } from "react";
import type { PermissionView } from "@/lib/sync/chat";
import classes from "./chat.module.css";

export interface PermissionHandler {
  (id: string, approved: boolean, decision?: "approved_for_session"): Promise<void>;
}

/** Outcome of an answered request, for the tool header. Approval is the
 * norm (and implied by the tool having run), so only refusals show. */
export function PermissionOutcome({ perm }: { perm?: PermissionView | undefined }) {
  if (!perm || perm.status === "pending" || perm.status === "approved") return null;
  const label = perm.status.charAt(0).toUpperCase() + perm.status.slice(1);
  const reason = "reason" in perm && perm.reason ? perm.reason : "";
  return (
    <span className={classes.permDone} title={reason || undefined}>
      <X size={12} />
      {label}
    </span>
  );
}

/** Allow/deny band for a pending request, embedded at the foot of its card. */
export function PermissionBar({ id, perm, onPermission }: { id: string; perm?: PermissionView | undefined; onPermission?: PermissionHandler | undefined }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (perm?.status !== "pending") return null;
  const answer = async (key: string, approved: boolean, decision?: "approved_for_session") => {
    if (!onPermission) return;
    setBusy(key);
    setError("");
    try {
      await onPermission(id, approved, decision);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={classes.perm} data-embedded role="group" aria-label="Permission required">
      <span className={classes.permTitle}>
        <ShieldQuestion size={16} className={classes.permIcon} />
        Permission required
      </span>
      <div className={classes.permActions}>
        <Button size="xs" variant="subtle" color="gray" loading={busy === "deny"} disabled={!!busy} onClick={() => void answer("deny", false)}>
          Deny
        </Button>
        <Button size="xs" variant="default" loading={busy === "session"} disabled={!!busy} onClick={() => void answer("session", true, "approved_for_session")}>
          Allow for session
        </Button>
        <Button size="xs" loading={busy === "allow"} disabled={!!busy} onClick={() => void answer("allow", true)}>
          Allow
        </Button>
      </div>
      {error && <span className={classes.permError}>{error}</span>}
    </div>
  );
}
