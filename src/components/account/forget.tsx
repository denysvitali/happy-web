import { Text } from "@mantine/core";
import { modals } from "@mantine/modals";

/** "Forget this device" with its confirmation; shared by settings and the palette. */
export function confirmForget(forget: () => Promise<void> | void): void {
  modals.openConfirmModal({
    title: "Forget this device?",
    children: (
      <Text size="sm">
        The stored account secret and token are deleted from this browser. You
        can link it again later.
      </Text>
    ),
    labels: { confirm: "Forget device", cancel: "Cancel" },
    confirmProps: { color: "red" },
    onConfirm: () => void forget(),
  });
}
