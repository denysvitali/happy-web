// Chat state for one session: durable rows (deduped by id and seq), optimistic
// sends (keyed by localId), and ephemeral stream previews (keyed by streamId).
// buildView() folds it into a render tree with tool results merged into their
// calls and child-agent activity nested under its Agent anchor.
import type { AgentState } from "./decode";
import type { AgentMetadata, Item, Normalized, Placed } from "./normalize";

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
  /** Attached images as data: URLs. */
  images?: string[] | undefined;
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

export interface ToolResult {
  output: unknown;
  isError: boolean;
  /** Reported terminal status (`completed`, `failed`, `unknown`, …). */
  status?: string | undefined;
  /** createdAt of the row that settled the call. */
  at?: number | undefined;
}

export interface ToolBlock {
  type: "tool";
  key: string;
  id: string;
  name: string;
  input: unknown;
  result?: ToolResult;
  permission?: PermissionView;
  children: Block[];
  /** Latest child-thread snapshot for Agent anchors (never coordinator defaults). */
  agentMetadata?: AgentMetadata | undefined;
  /** createdAt of the call row. */
  at?: number | undefined;
  /** Anchor synthesised for child rows whose spawn row has not arrived. */
  synthetic?: boolean;
}

export type Block =
  | { type: "user"; key: string; text: string; images?: string[] | undefined; pending?: "sending" | "failed"; at?: number | undefined }
  | { type: "text"; key: string; text: string; streaming?: boolean; at?: number | undefined }
  | { type: "thinking"; key: string; text: string; at?: number | undefined }
  | { type: "event"; key: string; text: string; at?: number | undefined }
  | { type: "unknown"; key: string; label: string }
  | ToolBlock
  /** A run of plain tool calls and thinking, shown as one collapsible line. */
  | { type: "steps"; key: string; items: StepBlock[] }
  /** Local-day separator before the first top-level block of each day. */
  | { type: "day"; key: string; at: number }
  | { type: "permission"; key: string; id: string; tool: string; input: unknown };

export interface ChatView {
  blocks: Block[];
  /** True while the last durable agent row is not `ready`. */
  turnOpen: boolean;
}

export const AGENT_TOOLS: ReadonlySet<string> = new Set(["Agent", "Task", "Workflow"]);
/** Calls that ask the user something: not folded while unanswered. */
const ASKING_TOOLS: ReadonlySet<string> = new Set(["AskUserQuestion", "ExitPlanMode", "exit_plan_mode"]);

export type StepBlock = ToolBlock | Extract<Block, { type: "thinking" }>;

/** A sub-agent anchor (rendered as its own card, never folded). */
export const isAgent = (b: ToolBlock): boolean => AGENT_TOOLS.has(b.name) || b.children.length > 0;

const isStep = (b: Block): b is StepBlock =>
  b.type === "thinking" || (b.type === "tool" && !isAgent(b) && !(ASKING_TOOLS.has(b.name) && !b.result) && b.permission?.status !== "pending");

/** Folds runs of two or more steps (plain tool calls and thinking) into one
 * `steps` block, recursively inside agent anchors. Text, questions, pending
 * permissions and sub-agents break a run. */
export function groupSteps(blocks: Block[]): Block[] {
  const out: Block[] = [];
  let run: StepBlock[] = [];
  const flush = () => {
    if (run.length >= 2) out.push({ type: "steps", key: `steps:${run[0]!.key}`, items: run });
    else out.push(...run);
    run = [];
  };
  for (const b of blocks) {
    if (b.type === "tool" && b.children.length > 0) b.children = groupSteps(b.children);
    if (isStep(b)) run.push(b);
    else {
      flush();
      out.push(b);
    }
  }
  flush();
  return out;
}

export const blockTime = (b: Block): number | undefined =>
  b.type === "steps" ? b.items[0]?.at : "at" in b ? b.at : undefined;

const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/** Inserts a `day` block before the first top-level block of each local day. */
export function withDays(blocks: Block[]): Block[] {
  const out: Block[] = [];
  let last = "";
  for (const b of blocks) {
    const t = blockTime(b);
    if (t !== undefined && t > 0) {
      const k = dayKey(t);
      if (k !== last) {
        out.push({ type: "day", key: `day:${k}`, at: t });
        last = k;
      }
    }
    out.push(b);
  }
  return out;
}

export function buildView(state: ChatState, agentState: AgentState): ChatView {
  const top: Block[] = [];
  const tools = new Map<string, ToolBlock>();
  let turnOpen = false;

  const anchor = (id: string, at: number): ToolBlock => {
    let t = tools.get(id);
    if (!t) {
      // A child row arrived before its spawn row: open the anchor now so the
      // child never overlays the parent chat; the real call fills it in.
      t = { type: "tool", key: `anchor:${id}`, id, name: "Agent", input: undefined, children: [], at, synthetic: true };
      tools.set(id, t);
      top.push(t);
    }
    return t;
  };

  const pushItem = (item: Placed, key: string, at: number) => {
    const meta = item.agentMetadata;
    const parentAnchor = item.parent ? anchor(item.parent, at) : undefined;
    const to = parentAnchor ? parentAnchor.children : top;
    switch (item.kind) {
      case "text":
        to.push(
          item.role === "user"
            ? { type: "user", key, text: item.text, ...(item.images ? { images: item.images } : {}), at }
            : { type: "text", key, text: item.text, at },
        );
        break;
      case "thinking":
        to.push({ type: "thinking", key, text: item.text, at });
        break;
      case "event":
        to.push({ type: "event", key, text: item.text, at });
        break;
      case "unknown":
        to.push({ type: "unknown", key, label: item.type });
        break;
      case "ready":
        return;
      case "tool-call": {
        const own = AGENT_TOOLS.has(item.name);
        const existing = tools.get(item.id);
        if (existing) {
          existing.input = item.input ?? existing.input;
          if (existing.synthetic) {
            existing.name = item.name;
            existing.at = at;
            delete existing.synthetic;
          }
        } else {
          const block: ToolBlock = { type: "tool", key, id: item.id, name: item.name, input: item.input, children: [], at };
          tools.set(item.id, block);
          to.push(block);
        }
        const t = tools.get(item.id)!;
        if (own) {
          const inputMeta = isObj(item.input) && isObj(item.input.agentMetadata) ? item.input.agentMetadata : undefined;
          const m = meta ?? inputMeta;
          if (m) t.agentMetadata = m;
          return;
        }
        break;
      }
      case "tool-result": {
        const t = tools.get(item.id);
        if (t) {
          // Child activity never settles the parent: results only attach by id.
          t.result = { output: item.output, isError: item.isError, status: item.status, at };
          if (meta && AGENT_TOOLS.has(t.name)) {
            t.agentMetadata = meta;
            return;
          }
        } else {
          to.push({ type: "event", key, text: `Result for unknown tool call ${item.id.slice(0, 12)}`, at });
        }
        break;
      }
    }
    // A child row's metadata describes the thread it belongs to.
    if (meta && parentAnchor) parentAnchor.agentMetadata = meta;
  };

  for (const m of state.messages) {
    m.norm.items.forEach((item: Item | Placed, i) => pushItem(item as Placed, `${m.id}:${i}`, m.createdAt));
    if (m.norm.role === "agent" && m.norm.items.length > 0) {
      turnOpen = !m.norm.items.some((i) => i.kind === "ready");
    } else if (m.norm.role === "user") {
      turnOpen = true;
    }
  }

  for (const p of state.pending) {
    top.push({ type: "user", key: `pending:${p.localId}`, text: p.text, ...(p.images ? { images: p.images } : {}), pending: p.failed ? "failed" : "sending", at: p.createdAt });
  }
  for (const p of [...state.previews.values()].sort((a, b) => a.at - b.at)) {
    // A child preview whose anchor is unknown is dropped, never shown in the parent chat.
    if (p.parent && !tools.has(p.parent)) continue;
    (p.parent ? tools.get(p.parent)!.children : top).push({ type: "text", key: `stream:${p.streamId}`, text: p.text, streaming: true, at: p.at });
  }

  // Permission state: request ids are tool-call ids.
  for (const [id, r] of Object.entries(agentState.completedRequests ?? {})) {
    const t = tools.get(id);
    if (t) t.permission = { status: r.status, decision: r.decision, reason: r.reason };
  }
  const orphans: Block[] = [];
  for (const [id, r] of Object.entries(agentState.requests ?? {})) {
    const t = tools.get(id);
    if (t) t.permission = { status: "pending" };
    else orphans.push({ type: "permission", key: `perm:${id}`, id, tool: r.tool, input: r.arguments });
  }

  return { blocks: [...withDays(groupSteps(top)), ...orphans], turnOpen };
}

// ---- memo support ---------------------------------------------------------

function sameList(a: readonly Block[], b: readonly Block[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameBlock(a[i]!, b[i]!)) return false;
  return true;
}

function sameTool(a: ToolBlock, b: ToolBlock): boolean {
  const ar = a.result;
  const br = b.result;
  const ap = a.permission as { status: string; decision?: string; reason?: string } | undefined;
  const bp = b.permission as { status: string; decision?: string; reason?: string } | undefined;
  return (
    a.name === b.name &&
    a.input === b.input &&
    a.agentMetadata === b.agentMetadata &&
    a.at === b.at &&
    a.synthetic === b.synthetic &&
    (ar === br || (!!ar && !!br && ar.output === br.output && ar.isError === br.isError && ar.status === br.status && ar.at === br.at)) &&
    (ap === bp || (!!ap && !!bp && ap.status === bp.status && ap.decision === bp.decision && ap.reason === bp.reason)) &&
    sameList(a.children, b.children)
  );
}

/** Structural equality of two views of the same block. buildView() returns
 * fresh objects, but inputs/outputs keep their identity (they come from
 * stored rows), so this is cheap and lets memoized views skip re-rendering
 * everything except the block that changed (e.g. a growing preview). */
export function sameBlock(a: Block, b: Block): boolean {
  if (a === b) return true;
  if (a.type !== b.type || a.key !== b.key) return false;
  if (a.type === "tool") return sameTool(a, b as ToolBlock);
  if (a.type === "steps") return sameList(a.items, (b as typeof a).items);
  const ao = a as unknown as Record<string, unknown>;
  const bo = b as unknown as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  return ak.every((k) => ao[k] === bo[k]);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
