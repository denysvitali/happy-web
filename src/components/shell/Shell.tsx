import { Outlet, useParams } from "@tanstack/react-router";
import { ConnectionBanner } from "./ConnectionBanner";
import { useCompact } from "./nav";
import { Sidebar } from "./Sidebar";
import { UpdatePrompt } from "./UpdatePrompt";
import classes from "./shell.module.css";

/**
 * Split view on wide screens. On phones a push stack: "/" is the session
 * list (the sidebar, full screen) and a session shows only its pane, whose
 * header carries a `NavButton` back to the list. Both panes stay mounted and
 * `data-pane` drives the slide (CSS transitions, so it is interruptible); the
 * list keeps its scroll position underneath.
 */
export function Shell() {
  const inSession = !!useParams({ strict: false }).sessionId;
  const compact = useCompact();
  const pane = inSession ? "detail" : "list";
  return (
    <div className={classes.root} data-pane={pane}>
      <ConnectionBanner />
      <aside className={classes.sidebar} aria-label="Sessions sidebar">
        <Sidebar />
      </aside>
      {/* Phones never see the overview: the list is home there. */}
      <main className={classes.main}>{compact && !inSession ? null : <Outlet />}</main>
      <UpdatePrompt />
    </div>
  );
}
