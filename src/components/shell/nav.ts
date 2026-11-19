import { useMediaQuery } from "@mantine/hooks";

/** Phones: push navigation ("/" is the session list, a session fills the screen).
 * Matches `$mantine-breakpoint-sm` (48em) used by the CSS modules. */
export const COMPACT_QUERY = "(max-width: 47.99em)";

export function useCompact(): boolean {
  return useMediaQuery(COMPACT_QUERY, false, { getInitialValueInEffect: false });
}
