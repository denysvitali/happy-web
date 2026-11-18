import { ActionIcon } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Link, Outlet } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useEffect } from "react";
import { ConnectionIndicator, Sidebar } from "./Sidebar";
import classes from "./shell.module.css";

/**
 * Two-column layout; below `sm` the sidebar becomes an off-canvas drawer
 * (pure CSS transform + backdrop, no AppShell/Drawer: the CSP forbids
 * runtime <style> and we keep the sidebar mounted across toggles).
 */
export function Shell() {
  const [open, { toggle, close }] = useDisclosure(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <div className={classes.root} data-nav-open={open || undefined}>
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
            <span className={classes.brandMark} aria-hidden>
              H
            </span>
            <span className={classes.brandName}>Happy</span>
          </Link>
          <div style={{ flex: 1 }} />
          <ConnectionIndicator compact />
        </header>
        <Outlet />
      </main>
    </div>
  );
}
