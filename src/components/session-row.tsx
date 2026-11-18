import type { ReactNode } from "react";
import { StatusBadge } from "@/components/status";
import type { SessionStatus } from "@/lib/sync/decode";

export function SessionRow({ title, subtitle, status }: { title: ReactNode; subtitle: string; status: SessionStatus }) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="text-muted-foreground truncate text-xs">{subtitle}</div>
      </div>
      <StatusBadge status={status} />
    </div>
  );
}
