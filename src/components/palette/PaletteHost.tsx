import { lazy, Suspense, useState } from "react";
import type { PaletteProps } from "./Palette";

// Loaded on first open; stays mounted afterwards so the close animation plays.
const Palette = lazy(() => import("./Palette"));

export function PaletteHost(props: PaletteProps) {
  const [loaded, setLoaded] = useState(false);
  if (props.opened && !loaded) setLoaded(true);
  if (!loaded) return null;
  return (
    <Suspense fallback={null}>
      <Palette {...props} />
    </Suspense>
  );
}
