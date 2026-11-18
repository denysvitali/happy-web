import { createContext } from "react";

/** Opens the off-canvas sidebar (mobile). Screens that replace the mobile
 * app bar with their own header render a `NavButton` with it. */
export const OpenNavContext = createContext<() => void>(() => undefined);
