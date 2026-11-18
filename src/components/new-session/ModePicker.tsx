import { UnstyledButton } from "@mantine/core";
import { Check, Container, Laptop } from "lucide-react";
import type { CSSProperties, KeyboardEvent } from "react";
import type { SpawnBackend } from "@/lib/sync/spawn";
import classes from "./new-session.module.css";

const MODES: Record<SpawnBackend, { title: string; text: string; icon: typeof Laptop }> = {
  local: { title: "Local", text: "Runs on one of your computers, in a folder you choose.", icon: Laptop },
  kubernetes: { title: "Kubernetes", text: "An isolated cloud workspace cloned from a Git repository.", icon: Container },
};

/** Large two-card radio group: the first and main choice of the form. */
export function ModePicker({ modes, value, onChange }: { modes: SpawnBackend[]; value: SpawnBackend; onChange: (m: SpawnBackend) => void }) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
    const next = modes[(modes.indexOf(value) + step + modes.length) % modes.length]!;
    onChange(next);
    (e.currentTarget.parentElement?.querySelector(`[data-mode="${next}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div className={classes.modes} role="radiogroup" aria-label="Where it runs" style={{ "--modes": modes.length } as CSSProperties}>
      {modes.map((m) => {
        const { title, text, icon: Icon } = MODES[m];
        const checked = m === value;
        return (
          <UnstyledButton
            key={m}
            className={classes.mode}
            role="radio"
            aria-checked={checked}
            data-checked={checked || undefined}
            data-mode={m}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(m)}
            onKeyDown={onKeyDown}
          >
            <span className={classes.modeIcon}>
              <Icon size={22} strokeWidth={1.75} />
            </span>
            <span>
              <span className={classes.modeTitle}>{title}</span>
              <span className={classes.modeText}>{text}</span>
            </span>
            <span className={classes.modeCheck} aria-hidden>
              {checked && <Check size={12} strokeWidth={3} />}
            </span>
          </UnstyledButton>
        );
      })}
    </div>
  );
}
