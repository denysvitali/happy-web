import { createContext } from "react";

/** Session whose sub-agent pages agent cards link to; without one (the
 * components demo, tests) a card is a plain summary. */
export const AgentSession = createContext<string | undefined>(undefined);
