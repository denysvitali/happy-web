import { ActionIcon, Textarea, Tooltip } from "@mantine/core";
import { ArrowUp, Square } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import classes from "./chat.module.css";

/** Message box with an optional toolbar (model, permissions, context) in its
 * bottom row, next to abort/send. */
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
    <div className={classes.composerBox} data-disabled={disabled || undefined}>
      <Textarea
        variant="unstyled"
        classNames={{ input: classes.composerInput }}
        autosize
        minRows={1}
        maxRows={10}
        placeholder="Message the agent…"
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={onKey}
        disabled={disabled}
        aria-label="Message"
      />
      <div className={classes.composerBar}>
        <div className={classes.composerTools}>{tools}</div>
        {!tools && <span className={classes.composerHint}>Enter to send · Shift+Enter for a new line</span>}
        {canAbort && onAbort && (
          <Tooltip label="Stop the current turn" openDelay={300}>
            <ActionIcon size={32} radius="xl" variant="default" onClick={onAbort} aria-label="Abort">
              <Square size={12} fill="currentColor" />
            </ActionIcon>
          </Tooltip>
        )}
        <ActionIcon size={32} radius="xl" onClick={send} disabled={disabled || !text.trim()} aria-label="Send">
          <ArrowUp size={17} strokeWidth={2.25} />
        </ActionIcon>
      </div>
    </div>
  );
}
