import { Badge, Button, Group, Text } from "@mantine/core";
import { ShieldQuestion } from "lucide-react";
import { useState } from "react";
import type { PermissionView } from "@/lib/sync/chat";
import classes from "./chat.module.css";

export interface PermissionHandler {
  (id: string, approved: boolean, decision?: "approved_for_session"): Promise<void>;
}

export function PermissionBar({ id, perm, onPermission }: { id: string; perm?: PermissionView | undefined; onPermission?: PermissionHandler | undefined }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!perm) return null;
  if (perm.status !== "pending") {
    const ok = perm.status === "approved";
    return (
      <Badge variant="light" color={ok ? "green" : "red"} size="xs" className={classes.permDone}>
        {perm.status}
        {"reason" in perm && perm.reason ? `: ${perm.reason}` : ""}
      </Badge>
    );
  }
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
    <div className={classes.perm} role="group" aria-label="Permission required">
      <Group gap="xs" wrap="nowrap" align="center">
        <ShieldQuestion size={16} className={classes.permIcon} />
        <Text size="sm" fw={600} style={{ flex: 1 }}>
          Permission required
        </Text>
      </Group>
      <Group gap="xs" mt={8}>
        <Button size="xs" loading={busy === "allow"} disabled={!!busy} onClick={() => void answer("allow", true)}>
          Allow
        </Button>
        <Button size="xs" variant="default" loading={busy === "session"} disabled={!!busy} onClick={() => void answer("session", true, "approved_for_session")}>
          Allow for session
        </Button>
        <Button size="xs" variant="subtle" color="red" loading={busy === "deny"} disabled={!!busy} onClick={() => void answer("deny", false)}>
          Deny
        </Button>
      </Group>
      {error && (
        <Text size="xs" c="red" mt={4}>
          {error}
        </Text>
      )}
    </div>
  );
}
