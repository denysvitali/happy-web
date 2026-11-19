import { Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ArrowUp, ImagePlus, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import type { OutgoingImage } from "@/lib/sync/chatStore";
import { IconButton } from "@/ui/IconButton";
import { getDraft, onPrefill, recall, setDraft } from "./draft";
import { MAX_TOTAL_BASE64, prepareImage, type Attachment } from "./attachments";
import { ImageStrip } from "./images";
import classes from "./chat.module.css";

const MAX_HEIGHT = 200;
const MAX_IMAGES = 6;
/** One paste bigger than this is refused: it would stall the textarea and exceed what a message can carry. */
const MAX_PASTE = 100_000;

/** Touch keyboards have no Shift+Enter: there Enter is a newline and the
 * send button sends. */
const touchKeyboard = () => window.matchMedia("(pointer: coarse)").matches;

/** Message capsule with image attachments and an optional toolbar
 * (permissions, model, context) above it. `canAttach` is false for agents
 * that only take text (Har, OpenCode). While a turn runs, Stop takes the
 * send button's place until there is something to send. */
export function Composer({
  draftKey,
  history = [],
  onSend,
  onAbort,
  canAbort,
  canAttach = true,
  disabled,
  placeholder,
  tools,
}: {
  /** Drafts are kept in memory per key (the session id) while the app runs. */
  draftKey: string;
  /** Messages sent in this session, oldest first: ↑/↓ recalls them. */
  history?: readonly string[];
  onSend: (text: string, images: OutgoingImage[]) => void;
  onAbort?: (() => void) | undefined;
  canAbort: boolean;
  canAttach?: boolean;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  tools?: ReactNode;
}) {
  const [text, setText] = useState(() => getDraft(draftKey));
  const [images, setImages] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pos = useRef(history.length);
  useEffect(() => {
    pos.current = history.length;
  }, [history.length]);
  const edit = (t: string) => {
    setText(t);
    setDraft(draftKey, t);
  };
  // "Edit & resend" from a message lands here.
  useEffect(
    () =>
      onPrefill(draftKey, (t) => {
        setText(t);
        pos.current = history.length;
        const el = ref.current;
        if (!el) return;
        el.focus();
        requestAnimationFrame(() => el.setSelectionRange(t.length, t.length));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftKey],
  );

  // Grow with content up to MAX_HEIGHT, then scroll.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  const attach = async (files: Blob[]) => {
    const picked = files.filter((f) => f.type.startsWith("image/"));
    if (!canAttach || picked.length === 0) return;
    setBusy(true);
    try {
      const prepared: Attachment[] = [];
      for (const f of picked) prepared.push(await prepareImage(f));
      setImages((cur) => {
        const next = [...cur];
        let total = next.reduce((n, i) => n + i.data.length, 0);
        for (const a of prepared) {
          if (next.length >= MAX_IMAGES || total + a.data.length > MAX_TOTAL_BASE64) {
            notifications.show({ color: "orange", message: "That is as many images as one message can carry." });
            break;
          }
          next.push(a);
          total += a.data.length;
        }
        return next;
      });
    } catch (e) {
      notifications.show({ color: "red", title: "Could not attach the image", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const ready = !disabled && !busy && (text.trim() !== "" || images.length > 0);
  const stoppable = canAbort && !!onAbort;
  const send = () => {
    if (!ready) return;
    onSend(text.trim(), images.map(({ mime, data }) => ({ mime, data })));
    edit("");
    setImages([]);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.currentTarget.blur();
      return;
    }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      const el = e.currentTarget;
      const p = pos.current;
      // Only while empty or showing an untouched recalled message, with the caret at the edge.
      const browsing = text === "" || (p < history.length && text === history[p]);
      // Caret on the first (up) or last (down) line, so multi-line text still moves by line.
      const edge = e.key === "ArrowUp" ? !text.slice(0, el.selectionStart).includes("\n") : !text.slice(el.selectionEnd).includes("\n");
      if (browsing && edge) {
        const r = recall(history, p, e.key === "ArrowUp" ? "up" : "down");
        if (r) {
          e.preventDefault();
          pos.current = r.pos;
          setText(r.text);
          setDraft(draftKey, r.text);
          requestAnimationFrame(() => el.setSelectionRange(r.text.length, r.text.length));
        }
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !touchKeyboard()) {
      e.preventDefault();
      send();
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData("text/plain");
    if (pasted.length > MAX_PASTE) {
      e.preventDefault();
      notifications.show({ color: "orange", title: "That paste is too large", message: `${pasted.length.toLocaleString()} characters; keep it under ${MAX_PASTE.toLocaleString()}, or save it to a file the agent can read.` });
      return;
    }
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (files.length === 0 || !canAttach) return;
    e.preventDefault();
    void attach(files);
  };
  const onDrop = (e: DragEvent) => {
    setDragging(false);
    if (!canAttach || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    void attach([...e.dataTransfer.files]);
  };

  return (
    <div className={classes.composerStack}>
      {tools && <div className={classes.composerTools}>{tools}</div>}
      <div
        className={classes.capsule}
        data-disabled={disabled || undefined}
        data-dragging={dragging || undefined}
        onDragOver={(e) => {
          if (!canAttach || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {images.length > 0 && (
          <ImageStrip images={images.map((i) => i.url)} onRemove={(i) => setImages((cur) => cur.filter((_, j) => j !== i))} />
        )}
        <div className={classes.capsuleRow}>
          {canAttach && (
            <>
              <Tooltip label="Attach images" openDelay={300}>
                <IconButton
                  label="Attach images"
                  className={classes.attach}
                  icon={<ImagePlus size={18} strokeWidth={1.9} />}
                  onClick={() => fileRef.current?.click()}
                  disabled={disabled || busy}
                />
              </Tooltip>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  void attach([...(e.currentTarget.files ?? [])]);
                  e.currentTarget.value = "";
                }}
              />
            </>
          )}
          <textarea
            ref={ref}
            className={classes.composerInput}
            rows={1}
            placeholder={placeholder ?? "Message the agent…"}
            value={text}
            onChange={(e) => {
              pos.current = history.length;
              edit(e.currentTarget.value);
            }}
            onKeyDown={onKey}
            onPaste={onPaste}
            disabled={disabled}
            aria-label="Message"
          />
          <div className={classes.composerActions}>
            {stoppable && (
              <Tooltip label="Stop the current turn" openDelay={300}>
                <IconButton label="Abort" icon={<Square size={11} fill="currentColor" />} variant={ready ? "tinted" : "filled"} tone="danger" onClick={onAbort} />
              </Tooltip>
            )}
            {(ready || !stoppable) && (
              <IconButton label="Send" icon={<ArrowUp size={17} strokeWidth={2.25} />} variant="filled" onClick={send} disabled={!ready} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
