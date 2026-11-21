import { Outlet, useParams, useRouterState } from "@tanstack/react-router";
import { useRef, type CSSProperties } from "react";
import { ConnectionBanner } from "./ConnectionBanner";
import { useCompact } from "./nav";
import { Sidebar } from "./Sidebar";
import { SidebarResizer } from "./SidebarResizer";
import { useSidebarLayout } from "./sidebarLayout";
import { UpdatePrompt } from "./UpdatePrompt";
import classes from "./shell.module.css";

/**
 * Split view on wide screens: the sidebar is resizable and folds to an icon
 * rail (`sidebarLayout.ts`). On phones a push stack: "/" is the session
 * list (the sidebar, full screen) and a session shows only its pane, whose
 * header carries a `NavButton` back to the list. Both panes stay mounted and
 * `data-pane` drives the slide (CSS transitions, so it is interruptible); the
 * list keeps its scroll position underneath.
 */
export function Shell() {
  const hasSession = !!useParams({ strict: false }).sessionId;
  const inInbox = useRouterState({ select: (s) => s.location.pathname.startsWith("/inbox") });
  // Phones push the Inbox like a session.
  const inSession = hasSession || inInbox;
  const compact = useCompact();
  const layout = useSidebarLayout();
  const rail = layout.collapsed && !compact;
  const rootRef = useRef<HTMLDivElement>(null);
  const pane = inSession ? "detail" : "list";
  // A CSSOM custom property, not a style attribute, so CSP allows it.
  const style = { "--happy-sidebar-width": `${layout.width}px` } as CSSProperties;
  return (
    <div ref={rootRef} className={classes.root} data-pane={pane} data-sidebar={rail ? "rail" : undefined} style={style}>
      <ConnectionBanner />
      <aside className={classes.sidebar} aria-label="Sessions sidebar">
        <Sidebar rail={rail} />
        {!compact && <SidebarResizer rootRef={rootRef} />}
      </aside>
      {/* Phones never see the overview: the list is home there. */}
      <main className={classes.main}>{compact && !inSession ? null : <Outlet />}</main>
      <UpdatePrompt />
    </div>
  );
}
