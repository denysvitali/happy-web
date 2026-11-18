import { ActionIcon } from "@mantine/core";
import { Menu } from "lucide-react";
import { use } from "react";
import { OpenNavContext } from "./nav";

/** Hamburger for headers that stand in for the mobile app bar. */
export function NavButton() {
  const open = use(OpenNavContext);
  return (
    <ActionIcon variant="subtle" color="gray" className="mantine-hidden-from-sm" onClick={open} aria-label="Open menu">
      <Menu size={18} />
    </ActionIcon>
  );
}
