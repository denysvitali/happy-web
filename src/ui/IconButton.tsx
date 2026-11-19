import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import classes from "./IconButton.module.css";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Accessible name; required because the button shows only an icon. */
  label: string;
  icon: ReactNode;
  /** plain: glyph only · tinted: accent-tinted disc · filled: accent disc · gray: neutral disc. */
  variant?: "plain" | "tinted" | "filled" | "gray";
  tone?: "accent" | "neutral" | "danger";
  size?: "sm" | "md" | "lg";
}

/** Circular icon-only button. Pair with a Mantine Tooltip when the glyph is not obvious. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = "plain", tone = "neutral", size = "md", className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={className ? `${classes.root} ${className}` : classes.root}
      data-variant={variant}
      data-tone={tone}
      data-size={size}
      {...rest}
    >
      {icon}
    </button>
  );
});
