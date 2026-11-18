import classes from "./shell/shell.module.css";

/** The Happy mark: a smile on a brand-gradient tile. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <span className={classes.brandMark} style={size === 26 ? undefined : { width: size, height: size, borderRadius: Math.round(size * 0.3) }} aria-hidden>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 16 16" fill="none">
        <circle cx="5.2" cy="6" r="1.25" fill="currentColor" />
        <circle cx="10.8" cy="6" r="1.25" fill="currentColor" />
        <path d="M4.3 9.4c.9 1.5 2.2 2.3 3.7 2.3s2.8-.8 3.7-2.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}
