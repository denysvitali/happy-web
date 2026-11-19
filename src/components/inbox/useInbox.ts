import { useMemo } from "react";
import { useAccount } from "@/app/auth";
import { useSessions, useStore } from "@/app/hooks";
import type { SessionItem } from "@/lib/sync/account";
import { inboxCatalog, unreadCount } from "@/lib/sync/inbox";

const NO_SESSIONS: SessionItem[] = [];

/** Every Inbox message (newest first) with the local triage and unread count. */
export function useInbox() {
  const account = useAccount();
  const sessions = useSessions();
  const states = useStore(account.inbox.states);
  const list = sessions.data ?? NO_SESSIONS;
  const items = useMemo(() => inboxCatalog(list), [list]);
  const unread = useMemo(() => unreadCount(items, states), [items, states]);
  return { items, states, unread, loading: sessions.isPending, triage: account.inbox };
}
