// Image thumbnails (sent and to-be-sent); tapping one opens the lightbox,
// loaded on first use.
import { X } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import classes from "./chat.module.css";

const Lightbox = lazy(() => import("./lightbox"));

/** Row of thumbnails; tap one to see it full size. `onRemove` turns them
 * into removable composer chips. */
export function ImageStrip({ images, align = "start", onRemove }: { images: string[]; align?: "start" | "end"; onRemove?: (i: number) => void }) {
  const [shown, setShown] = useState(0);
  const [opened, setOpened] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      <div className={classes.images} data-align={align} data-editable={onRemove ? true : undefined}>
        {images.map((src, i) => (
          <div key={i} className={classes.thumb}>
            <button
              type="button"
              className={classes.thumbButton}
              onClick={(e) => {
                opener.current = e.currentTarget;
                setLoaded(true);
                setShown(i);
                setOpened(true);
              }}
              aria-label={`View image ${i + 1}`}
            >
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
      {loaded && (
        <Suspense fallback={null}>
          <Lightbox images={images} index={Math.min(shown, images.length - 1)} opened={opened} onIndex={setShown} onClose={() => setOpened(false)} onClosed={() => opener.current?.focus()} />
        </Suspense>
      )}
    </>
  );
}
