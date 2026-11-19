// An open session's chat as a render tree, shared by the chat screen and
// the sub-agent page, plus the spacing between transcript rows.
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "@/app/auth";
import { useStore } from "@/app/hooks";
import type { SessionItem } from "@/lib/sync/account";
import { buildView, emptyChat, isAgent, type Block, type ChatView } from "@/lib/sync/chat";
import type { ChatStore } from "@/lib/sync/chatStore";
import { Store } from "@/lib/sync/store";

export function useChat(session: SessionItem | undefined): ChatStore | null {
  const account = useAccount();
  const [store, setStore] = useState<ChatStore | null>(null);
  const id = session?.id;
  useEffect(() => {
    if (!session) return;
    let release: (() => void) | undefined;
    let cancelled = false;
    void account.openChat(session).then((r) => {
      if (cancelled) return r.release();
      release = r.release;
      setStore(r.store);
    });
    return () => {
      cancelled = true;
      release?.();
      setStore(null);
    };
    // Only re-open when the session id changes, not on every row patch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, id]);
  return store;
}

const EMPTY = new Store(emptyChat);

export function useChatView(store: ChatStore | null, session: SessionItem | undefined): ChatView | null {
  const state = useStore(store?.state ?? EMPTY);
  const agentState = session?.agentState;
  return useMemo(() => (store && session ? buildView(state, agentState ?? {}) : null), [store, session, state, agentState]);
}

const TOOLISH = new Set<Block["type"]>(["tool", "steps", "thinking", "permission", "work"]);

const isCard = (b: Block) => b.type === "permission" || (b.type === "tool" && (isAgent(b) || b.permission?.status === "pending"));

/** Space above a block, from what precedes it: a speaker change is a new
 * turn, runs of tool rows sit tight, everything else is one block apart. */
export function gapOf(prev: Block | undefined, b: Block): "tight" | "near" | "block" | "turn" | undefined {
  if (!prev) return undefined;
  if (prev.type === "day" || b.type === "day") return "block";
  if ((b.type === "user") !== (prev.type === "user")) return "turn";
  // Cards (sub-agents, attention) need air between them; one-line steps do not.
  if (TOOLISH.has(b.type) && TOOLISH.has(prev.type)) return isCard(b) || isCard(prev) ? "near" : "tight";
  return "block";
}
