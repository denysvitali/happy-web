import { Send, Square } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

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
    <div className="flex items-end gap-2">
      <Textarea
        rows={Math.min(8, Math.max(1, text.split("\n").length))}
        placeholder={disabled ? "Session is not accepting messages" : "Message… (Enter to send, Shift+Enter for a new line)"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        disabled={disabled}
        aria-label="Message"
      />
      {canAbort && onAbort && (
        <Button variant="outline" size="icon" onClick={onAbort} aria-label="Abort">
          <Square />
        </Button>
      )}
      <Button size="icon" onClick={send} disabled={disabled || !text.trim()} aria-label="Send">
        <Send />
      </Button>
    </div>
  );
}
