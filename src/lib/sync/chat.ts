// Chat state for one session: durable rows (deduped by id and seq), optimistic
// sends (keyed by localId), and ephemeral stream previews (keyed by streamId).
// buildView() folds it into a render tree with tool results merged into their
// calls and child-agent activity nested under its Agent anchor.
import type { AgentState } from "./decode";
import type { Item, Normalized, Placed } from "./normalize";

export interface ChatMessage {
  id: string;
  seq: number;
  localId?: string | undefined;
  createdAt: number;
  norm: Normalized;
}

export interface Pending {
  localId: string;
  text: string;
  createdAt: number;
  failed?: boolean;
}

export interface Preview {
  streamId: string;
  text: string;
  parent?: string | undefined;
  at: number;
}

export interface ChatState {
  /** Sorted by seq ascending. */
  messages: ChatMessage[];
  ids: ReadonlySet<string>;
  maxSeq: number;
  pending: Pending[];
  previews: ReadonlyMap<string, Preview>;
  /** streamIds whose final row has landed: previews for them are ignored. */
  finalStreams: ReadonlySet<string>;
}

export const MAX_PREVIEWS = 32;
export const MAX_PREVIEW_BYTES = 256 * 1024;

export const emptyChat: ChatState = {
  messages: [],
  ids: new Set(),
  maxSeq: 0,
  pending: [],
  previews: new Map(),
  finalStreams: new Set(),
};

function streamIdsOf(m: ChatMessage): string[] {
  return m.norm.items.flatMap((i) => (i.kind === "text" && i.streamId ? [i.streamId] : []));
}

export function addMessages(state: ChatState, incoming: ChatMessage[]): ChatState {
  const seqs = new Set(state.messages.map((m) => m.seq));
  const fresh = incoming.filter((m) => !state.ids.has(m.id) && !seqs.has(m.seq));
  if (fresh.length === 0) return state;
  const ids = new Set(state.ids);
  const finalStreams = new Set(state.finalStreams);
  const previews = new Map(state.previews);
  const landed = new Set<string>();
  let maxSeq = state.maxSeq;
  for (const m of fresh) {
    ids.add(m.id);
    seqs.add(m.seq);
    maxSeq = Math.max(maxSeq, m.seq);
    if (m.localId) landed.add(m.localId);
    for (const sid of streamIdsOf(m)) {
      finalStreams.add(sid);
      previews.delete(sid);
    }
  }
  const messages = [...state.messages, ...fresh].sort((a, b) => a.seq - b.seq);
  return {
    messages,
    ids,
    maxSeq,
    pending: state.pending.filter((p) => !landed.has(p.localId)),
    previews,
    finalStreams,
  };
}

export function addPending(state: ChatState, p: Pending): ChatState {
  return { ...state, pending: [...state.pending.filter((x) => x.localId !== p.localId), p] };
}

export function failPending(state: ChatState, localId: string): ChatState {
  return { ...state, pending: state.pending.map((p) => (p.localId === localId ? { ...p, failed: true } : p)) };
}

/** Applies a decrypted `message-stream` snapshot (full text so far). */
export function addPreview(state: ChatState, p: Preview): ChatState {
  if (state.finalStreams.has(p.streamId)) return state;
  if (!p.text || p.text.length > MAX_PREVIEW_BYTES) return state;
  const prev = state.previews.get(p.streamId);
  if (prev && p.text.length <= prev.text.length) return state;
  if (!prev && state.previews.size >= MAX_PREVIEWS) return state;
  const previews = new Map(state.previews);
  previews.set(p.streamId, p);
  return { ...state, previews };
}

/** A session went `ready`/stopped: previews that never finalised are stale. */
export function clearPreviews(state: ChatState): ChatState {
  return state.previews.size === 0 ? state : { ...state, previews: new Map() };
}

// ---- view -----------------------------------------------------------------

export type PermissionView =
  | { status: "pending" }
  | { status: string; decision?: string | undefined; reason?: string | undefined };

export type Block =
  | { type: "user"; key: string; text: string; pending?: "sending" | "failed" }
  | { type: "text"; key: string; text: string; streaming?: boolean }
  | { type: "thinking"; key: string; text: string }
  | { type: "event"; key: string; text: string }
  | { type: "unknown"; key: string; label: string }
  | {
      type: "tool";
      key: string;
      id: string;
      name: string;
      input: unknown;
      result?: { output: unknown; isError: boolean };
      permission?: PermissionView;
      children: Block[];
    }
  | { type: "permission"; key: string; id: string; tool: string; input: unknown };

type ToolBlock = Extract<Block, { type: "tool" }>;

export interface ChatView {
  blocks: Block[];
  /** True while the last durable agent row is not `ready`. */
  turnOpen: boolean;
}

export function buildView(state: ChatState, agentState: AgentState): ChatView {
  const top: Block[] = [];
  const tools = new Map<string, ToolBlock>();
  // Child agents keyed by Codex thread id / agentId → their anchor tool.
  const sink = (parent: string | undefined): Block[] => (parent && tools.get(parent)?.children) || top;
  let turnOpen = false;

  const pushItem = (item: Placed, key: string) => {
    const to = sink(item.parent);
    switch (item.kind) {
      case "text":
        to.push(item.role === "user" ? { type: "user", key, text: item.text } : { type: "text", key, text: item.text });
        return;
      case "thinking":
        to.push({ type: "thinking", key, text: item.text });
        return;
      case "event":
        to.push({ type: "event", key, text: item.text });
        return;
      case "unknown":
        to.push({ type: "unknown", key, label: item.type });
        return;
      case "ready":
        return;
      case "tool-call": {
        const existing = tools.get(item.id);
        if (existing) {
          existing.input = item.input ?? existing.input;
          return;
        }
        const block: ToolBlock = { type: "tool", key, id: item.id, name: item.name, input: item.input, children: [] };
        tools.set(item.id, block);
        to.push(block);
        return;
      }
      case "tool-result": {
        const t = tools.get(item.id);
        if (t) {
          // Child activity never settles the parent: results only attach by id.
          t.result = { output: item.output, isError: item.isError };
        } else {
          to.push({ type: "event", key, text: `Result for unknown tool call ${item.id.slice(0, 12)}` });
        }
        return;
      }
    }
  };

  for (const m of state.messages) {
    m.norm.items.forEach((item: Item | Placed, i) => pushItem(item as Placed, `${m.id}:${i}`));
    if (m.norm.role === "agent" && m.norm.items.length > 0) {
      turnOpen = !m.norm.items.some((i) => i.kind === "ready");
    } else if (m.norm.role === "user") {
      turnOpen = true;
    }
  }

  for (const p of state.pending) {
    top.push({ type: "user", key: `pending:${p.localId}`, text: p.text, pending: p.failed ? "failed" : "sending" });
  }
  for (const p of [...state.previews.values()].sort((a, b) => a.at - b.at)) {
    sink(p.parent).push({ type: "text", key: `stream:${p.streamId}`, text: p.text, streaming: true });
  }

  // Permission state: request ids are tool-call ids.
  for (const [id, r] of Object.entries(agentState.completedRequests ?? {})) {
    const t = tools.get(id);
    if (t) t.permission = { status: r.status, decision: r.decision, reason: r.reason };
  }
  for (const [id, r] of Object.entries(agentState.requests ?? {})) {
    const t = tools.get(id);
    if (t) t.permission = { status: "pending" };
    else top.push({ type: "permission", key: `perm:${id}`, id, tool: r.tool, input: r.arguments });
  }

  return { blocks: top, turnOpen };
}
