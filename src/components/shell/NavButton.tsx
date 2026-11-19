import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import classes from "./shell.module.css";

/** Phone back affordance (a chevron to "/") for pane headers; hidden in the
 * split view. Icon-only so the session title gets the bar's width. */
export function NavButton() {
  return (
    <Link to="/" className={classes.back} aria-label="Back to sessions" title="Sessions">
      <ChevronLeft size={26} strokeWidth={2.2} />
    </Link>
  );
}
