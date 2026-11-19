// Per-message action bar: time, Copy, Copy as Markdown and, for the user's
// own messages, Edit & resend. A floating capsule that takes no layout space;
// hover reveals it on pointer devices, a tap (the message is focusable) on
// touch screens, so nothing is hover-only.
import { Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Copy, FileText, Pencil } from "lucide-react";
import { useContext, type ReactNode } from "react";
import { IconButton } from "@/ui/IconButton";
import { ResendContext } from "./draft";
import { TimeLabel } from "./primitives";
import { plainText } from "./text";
import classes from "./chat.module.css";

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notifications.show({ id: "copied", message: `${what} copied`, autoClose: 1400, withCloseButton: false });
  } catch {
    notifications.show({ id: "copied", color: "red", message: "Could not copy", autoClose: 2500 });
  }
}

function Action({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <Tooltip label={label} openDelay={300}>
      <IconButton
        label={label}
        size="sm"
        icon={icon}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      />
    </Tooltip>
  );
}

/** `text` is the message's markdown source. */
export function MessageActions({ at, text, user = false }: { at?: number | undefined; text: string; user?: boolean }) {
  const resend = useContext(ResendContext);
  const plain = text ? plainText(text) : "";
  return (
    <div className={classes.rowTools} role="toolbar" aria-label="Actions">
      <TimeLabel at={at} />
      {text && (
        <>
          <Action label="Copy" icon={<Copy size={13} strokeWidth={1.9} />} onClick={() => void copy(plain, "Text")} />
          {plain !== text && <Action label="Copy as Markdown" icon={<FileText size={13} strokeWidth={1.9} />} onClick={() => void copy(text, "Markdown")} />}
          {user && resend && <Action label="Edit & resend" icon={<Pencil size={13} strokeWidth={1.9} />} onClick={() => resend(text)} />}
        </>
      )}
    </div>
  );
}
