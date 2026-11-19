import { Modal } from "@mantine/core";
import { modals } from "@mantine/modals";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./IconButton";
import classes from "./Sheet.module.css";

/**
 * Open a titled sheet (centred card; bottom sheet on phones) through the
 * ModalsProvider. `children` receives `close`; compose it from SheetBody and
 * SheetFooter (wrap both in a <form> to submit from the footer).
 */
export function openSheet({ title, size = 520, children }: { title: ReactNode; size?: number; children: (close: () => void) => ReactNode }): string {
  const close = () => modals.close(id);
  const id = modals.open({
    size,
    padding: 0,
    classNames: { root: classes.root, inner: classes.inner, content: classes.content, body: classes.sheetBody },
    children: (
      <>
        <header className={classes.bar}>
          <Modal.Title className={classes.title}>{title}</Modal.Title>
          <IconButton className={classes.close} label="Close" icon={<X size={16} strokeWidth={2.25} />} variant="gray" size="sm" onClick={close} />
        </header>
        {children(close)}
      </>
    ),
  });
  return id;
}

/** Scrolling content of a sheet: stacked sections with even rhythm. */
export function SheetBody({ children }: { children: ReactNode }) {
  return <div className={classes.body}>{children}</div>;
}

/** Sticky action bar; `note` sits at the leading edge, actions trail (last = primary). */
export function SheetFooter({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return (
    <footer className={classes.footer}>
      {note && <div className={classes.note}>{note}</div>}
      <div className={classes.actions}>{children}</div>
    </footer>
  );
}
