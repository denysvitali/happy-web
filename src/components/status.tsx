import { Badge, Loader } from "@mantine/core";
import type { SessionStatus } from "@/lib/sync/decode";

const COLOR: Record<SessionStatus, string> = { thinking: "blue", active: "green", idle: "gray", archived: "gray" };

export function StatusBadge({ status, size = "sm" }: { status: SessionStatus; size?: "xs" | "sm" }) {
  return (
    <Badge
      size={size}
      variant={status === "idle" || status === "archived" ? "outline" : "light"}
      color={COLOR[status]}
      leftSection={status === "thinking" ? <Loader size={8} color="blue" type="dots" /> : undefined}
    >
      {status}
    </Badge>
  );
}

export function OnlineDot({ online }: { online: boolean }) {
  return (
    <span
      aria-label={online ? "online" : "offline"}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        flexShrink: 0,
        background: online ? "var(--mantine-color-green-6)" : "var(--mantine-color-gray-5)",
      }}
    />
  );
}
