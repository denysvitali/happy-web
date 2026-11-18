import { Badge } from "@/components/ui/badge";
import type { SessionStatus } from "@/lib/sync/decode";

const LABEL: Record<SessionStatus, string> = { thinking: "thinking", active: "active", idle: "idle", archived: "archived" };
const VARIANT = { thinking: "thinking", active: "active", idle: "default", archived: "default" } as const;

export function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <Badge variant={VARIANT[status]}>
      <span className={`size-1.5 rounded-full bg-current ${status === "thinking" ? "animate-pulse" : ""}`} />
      {LABEL[status]}
    </Badge>
  );
}
