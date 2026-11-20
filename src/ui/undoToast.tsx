import { UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import classes from "./undoToast.module.css";

let seq = 0;

/** A short confirmation toast with an Undo button, like a mail client. */
export function showUndo(message: string, onUndo: () => void): void {
  const id = `undo-${++seq}`;
  notifications.show({
    id,
    autoClose: 5000,
    message: (
      <span className={classes.toast}>
        {message}
        <UnstyledButton
          className={classes.undo}
          onClick={() => {
            notifications.hide(id);
            onUndo();
          }}
        >
          Undo
        </UnstyledButton>
      </span>
    ),
  });
}
