import { ActionIcon, Alert, Autocomplete, Badge, Button, Checkbox, CloseButton, Code, Collapse, Combobox, createTheme, Input, InputWrapper, Kbd, Loader, Menu, Modal, MultiSelect, Notification, Paper, Pill, Popover, SegmentedControl, Select, Switch, TagsInput, Tooltip } from "@mantine/core";
import actionIcon from "@/ui/mantine/ActionIcon.module.css";
import alert from "@/ui/mantine/Alert.module.css";
import badge from "@/ui/mantine/Badge.module.css";
import button from "@/ui/mantine/Button.module.css";
import checkbox from "@/ui/mantine/Checkbox.module.css";
import closeButton from "@/ui/mantine/CloseButton.module.css";
import code from "@/ui/mantine/Code.module.css";
import combobox from "@/ui/mantine/Combobox.module.css";
import input from "@/ui/mantine/Input.module.css";
import kbd from "@/ui/mantine/Kbd.module.css";
import menu from "@/ui/mantine/Menu.module.css";
import modal from "@/ui/mantine/Modal.module.css";
import notification from "@/ui/mantine/Notification.module.css";
import paper from "@/ui/mantine/Paper.module.css";
import pill from "@/ui/mantine/Pill.module.css";
import popover from "@/ui/mantine/Popover.module.css";
import segmented from "@/ui/mantine/SegmentedControl.module.css";
import switchClasses from "@/ui/mantine/Switch.module.css";
import tooltip from "@/ui/mantine/Tooltip.module.css";

// Theme CSS variables are not injected at runtime (strict CSP forbids inline
// <style>): colours, fonts and radii are re-pointed statically in
// src/ui/tokens.css. Components are skinned with static CSS modules in
// src/ui/mantine/ via `classNames`; keep this file to props and wiring.
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)"; // --happy-ease (JS needs the literal)
// Every combobox-backed input shares one dropdown look.
const comboboxProps = { shadow: "lg", offset: 6, transitionProps: { transition: "pop", duration: 110, exitDuration: 0 } } as const;

export const theme = createTheme({
  primaryColor: "blue",
  defaultRadius: "md",
  cursorType: "pointer",
  respectReducedMotion: true,
  components: {
    Button: Button.extend({ classNames: button }),
    Input: Input.extend({ classNames: input }),
    InputWrapper: InputWrapper.extend({ classNames: input, defaultProps: { inputWrapperOrder: ["label", "input", "description", "error"] } }),
    Select: Select.extend({ classNames: combobox, defaultProps: { comboboxProps } }),
    Autocomplete: Autocomplete.extend({ classNames: combobox, defaultProps: { comboboxProps } }),
    MultiSelect: MultiSelect.extend({ classNames: combobox, defaultProps: { comboboxProps } }),
    TagsInput: TagsInput.extend({ classNames: combobox, defaultProps: { comboboxProps } }),
    Combobox: Combobox.extend({ classNames: combobox, defaultProps: comboboxProps }),
    Pill: Pill.extend({ classNames: pill }),
    Popover: Popover.extend({ classNames: popover, defaultProps: { shadow: "lg", offset: 8, transitionProps: { transition: "pop", duration: 160 } } }),
    Checkbox: Checkbox.extend({ classNames: checkbox }),
    Switch: Switch.extend({ classNames: switchClasses, defaultProps: { size: "md", withThumbIndicator: false } }),
    Kbd: Kbd.extend({ classNames: kbd }),
    CloseButton: CloseButton.extend({ classNames: closeButton }),
    ActionIcon: ActionIcon.extend({ classNames: actionIcon }),
    Menu: Menu.extend({ classNames: menu, defaultProps: { shadow: "lg", offset: 6, transitionProps: { transition: "pop", duration: 140 } } }),
    Tooltip: Tooltip.extend({ classNames: tooltip, defaultProps: { openDelay: 400, offset: 6, transitionProps: { transition: "fade", duration: 120 } } }),
    // Modal defaults read as an alert (compact, no close button); src/ui/Sheet
    // opens larger titled sheets. react-remove-scroll injects a <style>
    // element, which the CSP blocks, hence lockScroll off.
    Modal: Modal.extend({
      classNames: modal,
      defaultProps: {
        lockScroll: false,
        centered: true,
        size: 360,
        radius: "xl",
        padding: 20,
        withCloseButton: false,
        transitionProps: {
          duration: 220,
          timingFunction: EASE,
          transition: { in: { opacity: 1, transform: "scale(1)" }, out: { opacity: 0, transform: "scale(0.96)" }, transitionProperty: "opacity, transform" },
        },
      },
    }),
    Drawer: { defaultProps: { lockScroll: false } },
    Notification: Notification.extend({ classNames: notification }),
    SegmentedControl: SegmentedControl.extend({ classNames: segmented, defaultProps: { radius: 9, transitionDuration: 220, transitionTimingFunction: EASE } }),
    Alert: Alert.extend({ classNames: alert }),
    Badge: Badge.extend({ classNames: badge }),
    Paper: Paper.extend({ classNames: paper }),
    Code: Code.extend({ classNames: code }),
    Loader: Loader.extend({ defaultProps: { color: "var(--happy-label-2)", size: "sm", type: "oval" } }),
    Collapse: Collapse.extend({ defaultProps: { transitionDuration: 220, transitionTimingFunction: EASE } }),
  },
});
