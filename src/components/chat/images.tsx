// Image thumbnails (sent and to-be-sent) and a lightbox.
import { Modal } from "@mantine/core";
import { X } from "lucide-react";
import { useState } from "react";
import classes from "./chat.module.css";

/** Row of thumbnails; tap one to see it full size. `onRemove` turns them
 * into removable composer chips. */
export function ImageStrip({ images, align = "start", onRemove }: { images: string[]; align?: "start" | "end"; onRemove?: (i: number) => void }) {
  const [shown, setShown] = useState<string | null>(null);
  return (
    <>
      <div className={classes.images} data-align={align} data-editable={onRemove ? true : undefined}>
        {images.map((src, i) => (
          <div key={i} className={classes.thumb}>
            <button type="button" className={classes.thumbButton} onClick={() => setShown(src)} aria-label={`View image ${i + 1}`}>
              <img src={src} alt="" />
            </button>
            {onRemove && (
              <button type="button" className={classes.thumbRemove} onClick={() => onRemove(i)} aria-label={`Remove image ${i + 1}`}>
                <X size={11} strokeWidth={3} />
              </button>
            )}
          </div>
        ))}
      </div>
      <Modal opened={shown !== null} onClose={() => setShown(null)} size="auto" centered lockScroll={false} withCloseButton={false} padding={0} classNames={{ content: classes.lightbox }}>
        {shown && (
          <button type="button" className={classes.lightboxImage} onClick={() => setShown(null)} aria-label="Close image">
            <img src={shown} alt="Attached image" />
          </button>
        )}
      </Modal>
    </>
  );
}
