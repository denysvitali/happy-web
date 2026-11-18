import { ActionIcon } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Link, Outlet, useParams } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useEffect } from "react";
import { OpenNavContext } from "./nav";
import { ConnectionIndicator, Sidebar } from "./Sidebar";
import { BrandMark } from "@/components/brand";
import classes from "./shell.module.css";

/**
 * Two-column layout; below `sm` the sidebar becomes an off-canvas drawer
 * (pure CSS transform + backdrop, no AppShell/Drawer: the CSP forbids
 * runtime <style> and we keep the sidebar mounted across toggles).
 */
export function Shell() {
  const [open, { toggle, open: show, close }] = useDisclosure(false);
  // A session's own header carries the menu button on mobile.
  const inSession = !!useParams({ strict: false }).sessionId;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <div className={classes.root} data-nav-open={open || undefined} data-in-session={inSession || undefined}>
      <aside className={classes.sidebar} aria-label="Sessions sidebar">
        <Sidebar onNavigate={close} />
      </aside>
      <div className={classes.backdrop} onClick={close} aria-hidden />
      <main className={classes.main}>
        <header className={classes.mobileBar}>
          <ActionIcon variant="subtle" color="gray" onClick={toggle} aria-label="Open menu" aria-expanded={open}>
            <Menu size={18} />
          </ActionIcon>
          <Link to="/" className={classes.brand}>
            <BrandMark />
            <span className={classes.brandName}>Happy</span>
          </Link>
          <div style={{ flex: 1 }} />
          <ConnectionIndicator compact />
        </header>
        <OpenNavContext value={show}>
          <Outlet />
        </OpenNavContext>
      </main>
    </div>
  );
}
