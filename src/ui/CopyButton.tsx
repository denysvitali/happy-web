import { CopyButton as MantineCopy, Tooltip } from "@mantine/core";
import { Check, Copy } from "lucide-react";
import { IconButton } from "./IconButton";

/** Icon-only copy-to-clipboard button; flips to a green check for a moment after copying. */
export function CopyButton({ value, label = "Copy", size = "sm", className }: { value: string; label?: string; size?: "sm" | "md"; className?: string | undefined }) {
  return (
    <MantineCopy value={value} timeout={1400}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? "Copied" : label}>
          <IconButton
            label={label}
            size={size}
            className={className}
            onClick={copy}
            style={copied ? { color: "var(--happy-green)" } : undefined}
            icon={copied ? <Check size={14} strokeWidth={2.25} /> : <Copy size={14} strokeWidth={1.75} />}
          />
        </Tooltip>
      )}
    </MantineCopy>
  );
}
