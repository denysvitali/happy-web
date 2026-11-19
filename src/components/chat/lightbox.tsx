// Full-size viewer for a message's images (lazy chunk, see images.tsx).
// A Modal, so focus is trapped and handed back to the thumbnail on close.
import { Modal } from "@mantine/core";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { IconButton } from "@/ui/IconButton";
import { imageFilename } from "./text";
import classes from "./chat.module.css";

export default function Lightbox({ images, index: i, opened, onIndex, onClose, onClosed }: { images: string[]; index: number; opened: boolean; onIndex: (i: number) => void; onClose: () => void; onClosed: () => void }) {
  const src = images[i];
  const go = (d: number) => onIndex((i + d + images.length) % images.length);
  const many = images.length > 1;

  const onKey = (e: KeyboardEvent) => {
    if (!many) return;
    if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
    else return;
    e.preventDefault();
  };
  const download = () => {
    if (!src) return;
    const a = document.createElement("a");
    a.href = src;
    a.download = imageFilename(src, i);
    a.click();
  };

  return (
    <Modal opened={opened} onClose={onClose} onExitTransitionEnd={onClosed} returnFocus={false} size="auto" centered lockScroll={false} withCloseButton={false} padding={0} classNames={{ content: classes.lightbox }} aria-label="Image viewer">
      {src && (
        <div className={classes.lbStage} onKeyDown={onKey}>
          <button type="button" className={classes.lightboxImage} onClick={onClose} aria-label="Close image" data-autofocus>
            <img src={src} alt={`Attached image ${i + 1} of ${images.length}`} />
          </button>
          <div className={classes.lbBar} role="toolbar" aria-label="Image controls">
            {many && <IconButton label="Previous image" icon={<ChevronLeft size={18} />} onClick={() => go(-1)} />}
            {many && (
              <span className={classes.lbCount} aria-live="polite">
                {i + 1} / {images.length}
              </span>
            )}
            {many && <IconButton label="Next image" icon={<ChevronRight size={18} />} onClick={() => go(1)} />}
            <IconButton label="Download image" icon={<Download size={17} />} onClick={download} />
            <IconButton label="Close" icon={<X size={18} />} onClick={onClose} />
          </div>
        </div>
      )}
    </Modal>
  );
}
