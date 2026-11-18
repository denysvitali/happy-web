import { ActionIcon, Group, Textarea, Tooltip } from "@mantine/core";
import { SendHorizontal, Square } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

export function Composer({
  onSend,
  onAbort,
  canAbort,
  disabled,
}: {
  onSend: (text: string) => void;
  onAbort?: (() => void) | undefined;
  canAbort: boolean;
  disabled?: boolean | undefined;
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
    <Group gap="xs" align="flex-end" wrap="nowrap">
      <Textarea
        style={{ flex: 1 }}
        autosize
        minRows={1}
        maxRows={8}
        radius="lg"
        placeholder="Message… (Enter to send, Shift+Enter for a new line)"
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={onKey}
        disabled={disabled}
        aria-label="Message"
      />
      {canAbort && onAbort && (
        <Tooltip label="Abort turn">
          <ActionIcon size={36} radius="xl" variant="light" color="red" onClick={onAbort} aria-label="Abort">
            <Square size={16} />
          </ActionIcon>
        </Tooltip>
      )}
      <ActionIcon size={36} radius="xl" onClick={send} disabled={disabled || !text.trim()} aria-label="Send">
        <SendHorizontal size={16} />
      </ActionIcon>
    </Group>
  );
}
