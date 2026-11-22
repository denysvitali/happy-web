// Find in session: the bar over the transcript (see reveal.ts for the rest).
import { UnstyledButton } from "@mantine/core";
import { ChevronDown, ChevronUp, History, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { SearchField } from "@/ui/SearchField";
import classes from "./chat.module.css";

export interface FindBarProps {
  query: string;
  onQuery: (q: string) => void;
  /** 0-based index of the current hit counted from the newest, or -1. */
  index: number;
  total: number;
  /** Older history exists that has not been loaded (and searched) yet. */
  more: boolean;
  loading: boolean;
  onOlder: () => void;
  onNewer: () => void;
  onLoadMore: () => void;
  onClose: () => void;
}

/** The find bar: field, "n of m", older/newer, and "search earlier" once the
 * loaded history is exhausted. Enter goes to older hits, Shift+Enter newer. */
export function FindBar({ query, onQuery, index, total, more, loading, onOlder, onNewer, onLoadMore, onClose }: FindBarProps) {
  const input = useRef<HTMLInputElement>(null);
  // Opening find is asking to type, phones included.
  useEffect(() => input.current?.focus(), []);
  const blank = !query.trim();
  const atOldest = index === total - 1;
  const count = blank ? "" : loading ? "Searching…" : total === 0 ? (more ? "None loaded" : "No results") : `${index + 1} of ${total}`;
  return (
    <div className={classes.find} role="search" aria-label="Find in session">
      <div className={classes.findField}>
        <SearchField
          ref={input}
          value={query}
          onChange={onQuery}
          placeholder="Find in session"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !query) {
              e.preventDefault();
              onClose();
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) onNewer();
              else if (atOldest && more) onLoadMore();
              else onOlder();
            } else if (e.key.toLowerCase() === "f" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.currentTarget.select();
            }
          }}
        />
      </div>
      <span className={classes.findCount} aria-live="polite">
        {count}
      </span>
      {!blank && more && (atOldest || total === 0) ? (
        <UnstyledButton className={classes.findMore} onClick={onLoadMore} disabled={loading}>
          {loading ? <LoaderCircle size={13} className={classes.spinner} aria-hidden /> : <History size={13} aria-hidden />} Earlier
        </UnstyledButton>
      ) : null}
      <UnstyledButton className={classes.findBtn} onClick={onOlder} disabled={total === 0 || atOldest} aria-label="Older match">
        <ChevronUp size={16} />
      </UnstyledButton>
      <UnstyledButton className={classes.findBtn} onClick={onNewer} disabled={total === 0 || index <= 0} aria-label="Newer match">
        <ChevronDown size={16} />
      </UnstyledButton>
      <UnstyledButton className={classes.findBtn} onClick={onClose} aria-label="Close find">
        <X size={16} />
      </UnstyledButton>
    </div>
  );
}
