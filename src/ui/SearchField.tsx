import { Search, X } from "lucide-react";
import { useImperativeHandle, useRef, type ReactNode, type Ref } from "react";
import classes from "./SearchField.module.css";

/**
 * Pill-shaped filled search field with a clear button; Escape clears.
 * `onKeyDown` runs first; call `preventDefault()` to skip the built-in Escape.
 * `hint` (e.g. a shortcut key) shows while the field is empty.
 */
export function SearchField({
  value,
  onChange,
  placeholder = "Search",
  label,
  hint,
  onKeyDown,
  ref,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  hint?: ReactNode;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  ref?: Ref<HTMLInputElement>;
}) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current!, []);
  return (
    <div className={classes.root}>
      <Search className={classes.icon} size={15} strokeWidth={2} aria-hidden />
      <input
        ref={input}
        type="search"
        className={classes.input}
        value={value}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (!e.defaultPrevented && e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
        autoComplete="off"
        spellCheck={false}
      />
      {value ? (
        <button
          type="button"
          className={classes.clear}
          aria-label="Clear search"
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
        >
          <X size={10} strokeWidth={3.25} />
        </button>
      ) : (
        hint && (
          <span className={classes.hint} aria-hidden>
            {hint}
          </span>
        )
      )}
    </div>
  );
}
