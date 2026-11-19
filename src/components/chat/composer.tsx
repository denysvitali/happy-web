import { Tooltip } from "@mantine/core";
import { ArrowUp, Square } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { IconButton } from "@/ui/IconButton";
import classes from "./chat.module.css";

const MAX_HEIGHT = 200;

/** Message capsule with an optional toolbar (permissions, model, context) above it. */
export function Composer({
  onSend,
  onAbort,
  canAbort,
  disabled,
  tools,
}: {
  onSend: (text: string) => void;
  onAbort?: (() => void) | undefined;
  canAbort: boolean;
  disabled?: boolean | undefined;
  tools?: ReactNode;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with content up to MAX_HEIGHT, then scroll.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  return (
    <div className={classes.composerStack}>
      {tools && <div className={classes.composerTools}>{tools}</div>}
      <div className={classes.capsule} data-disabled={disabled || undefined}>
        <textarea
          ref={ref}
          className={classes.composerInput}
          rows={1}
          placeholder="Message the agent…"
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={onKey}
          disabled={disabled}
          aria-label="Message"
        />
        <div className={classes.composerActions}>
          {canAbort && onAbort && (
            <Tooltip label="Stop the current turn" openDelay={300}>
              <IconButton label="Abort" icon={<Square size={12} fill="currentColor" />} variant="tinted" tone="danger" onClick={onAbort} />
            </Tooltip>
          )}
          <IconButton label="Send" icon={<ArrowUp size={17} strokeWidth={2.25} />} variant="filled" onClick={send} disabled={disabled || !text.trim()} />
        </div>
      </div>
    </div>
  );
}
