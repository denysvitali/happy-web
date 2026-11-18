import { ActionIcon, Group, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Outlet } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import classes from "./shell.module.css";

export function Shell() {
  const [open, { toggle, close }] = useDisclosure(false);
  return (
    <div className={classes.root} data-nav-open={open || undefined}>
      <aside className={classes.sidebar}>
        <Sidebar onNavigate={close} />
      </aside>
      <main className={classes.main}>
        <Group className={classes.mobileBar} px="sm" py={6} gap="xs" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
          <ActionIcon variant="subtle" color="gray" onClick={toggle} aria-label="Open menu">
            <Menu size={18} />
          </ActionIcon>
          <Text fw={700}>Happy</Text>
        </Group>
        <Outlet />
      </main>
    </div>
  );
}
