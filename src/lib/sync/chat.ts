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
  /** A background launch receipt: the agent is still running. */
  async?: true;
  /** No result ever came: the turn ended or the session stopped working
   * (e.g. its Pod died) while the call was open. Synthesised by settleOpen(). */
  interrupted?: true;
}

/** Latest lifecycle report of a background agent. */
export interface TaskState {
  status: string;
  summary?: string | undefined;
  at: number;
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
  /** Background-agent lifecycle (Claude task_* events). */
  task?: TaskState | undefined;
  /** The agent's own first user row, when the call input has no prompt. */
  prompt?: string | undefined;
}

/** Task statuses that end a background agent or shell job. */
export const TASK_TERMINAL: ReadonlySet<string> = new Set(["completed", "failed", "stopped", "killed", "cancelled", "canceled"]);

export type Block =
  | { type: "user"; key: string; text: string; images?: string[] | undefined; pending?: "sending" | "failed"; at?: number | undefined }
  | { type: "text"; key: string; text: string; streaming?: boolean; at?: number | undefined; model?: string | undefined }
  | { type: "thinking"; key: string; text: string; at?: number | undefined }
  | { type: "event"; key: string; text: string; at?: number | undefined }
  | { type: "unknown"; key: string; label: string }
  /** The thread's agent rows switched model (a user switch or a fallback). */
  | { type: "model"; key: string; from: string; to: string; at?: number | undefined }
  | ToolBlock
  /** A run of plain tool calls and thinking, shown as one collapsible line. */
  | { type: "steps"; key: string; items: StepBlock[] }
  /** A finished turn's working (narration, steps, agents) before its final
   * reply, folded into one line. `from`/`to` bound the turn. */
  | { type: "work"; key: string; items: Block[]; from?: number | undefined; to?: number | undefined }
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

/** The call with this id anywhere in a view (agents nest, runs fold). */
export function findTool(blocks: readonly Block[], id: string): ToolBlock | undefined {
  for (const b of blocks) {
    const hit =
      b.type === "tool" ? (b.id === id ? b : findTool(b.children, id)) : b.type === "steps" || b.type === "work" ? findTool(b.items, id) : undefined;
    if (hit) return hit;
  }
  return undefined;
}

export const blockTime = (b: Block): number | undefined =>
  b.type === "steps" || b.type === "work" ? (b.items[0] ? blockTime(b.items[0]) : undefined) : "at" in b ? b.at : undefined;

/** Blocks a finished turn must not hide: they still wait for the user. */
export const needsUser = (b: Block): boolean =>
  b.type === "permission" || (b.type === "tool" && (b.permission?.status === "pending" || (ASKING_TOOLS.has(b.name) && !b.result)));

/** Folds each finished agent turn: everything between the user's message and
 * the final reply (the trailing text) becomes one `work` block. The turn in
 * progress stays as it is, and so does anything that waits for the user. */
export function groupTurns(blocks: Block[], turnOpen: boolean): Block[] {
  // Split into [user, agent blocks…] segments; the newest one is the turn in
  // progress while turnOpen (a queued message after it does not finish it).
  const segs: { user?: Block; body: Block[] }[] = [{ body: [] }];
  for (const b of blocks) {
    if (b.type === "user") segs.push({ user: b, body: [] });
    else segs[segs.length - 1]!.body.push(b);
  }
  // Queued (optimistic) sends are skipped; a durable user row starts the live turn.
  let live = segs.length - 1;
  while (live > 0 && segs[live]!.body.length === 0 && segs[live]!.user?.type === "user" && segs[live]!.user!.key.startsWith("pending:")) live--;
  if (!turnOpen) live = -1;
  const out: Block[] = [];
  segs.forEach((g, i) => {
    if (g.user) out.push(g.user);
    out.push(...(i === live ? g.body : foldTurn(g.body, g.user && "at" in g.user ? g.user.at : undefined)));
  });
  return out;
}

/** Lines that may trail a reply without being work (e.g. "Context compacted"). */
const QUIET = new Set<Block["type"]>(["event", "unknown", "day"]);

function foldTurn(seg: Block[], since: number | undefined): Block[] {
  // The reply: the last run of text, when only quiet lines follow it.
  let last = seg.length - 1;
  while (last >= 0 && QUIET.has(seg[last]!.type)) last--;
  let start = last + 1;
  while (start > 0 && seg[start - 1]!.type === "text") start--;
  if (start > last) start = seg.length; // ended on work: no reply to keep
  const work: Block[] = [];
  const keep: Block[] = [];
  // Model switches stay visible too; one before any work stays above it.
  const lead: Block[] = [];
  for (const b of seg.slice(0, start)) {
    if (b.type === "model" && work.length === 0) lead.push(b);
    else (needsUser(b) || b.type === "model" ? keep : work).push(b);
  }
  if (work.length < 2) return seg;
  const reply = seg[start];
  const lastWork = work[work.length - 1]!;
  const to = (reply ? blockTime(reply) : undefined) ?? (lastWork.type === "tool" ? (lastWork.result?.at ?? lastWork.at) : blockTime(lastWork));
  return [...lead, { type: "work", key: `work:${work[0]!.key}`, items: work, from: since ?? blockTime(work[0]!), to }, ...keep, ...seg.slice(start)];
}

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

/** Whether an agent's child user row is its prompt: it repeats the call's
 * prompt, or it opens an agent whose call carries none (then it is kept on
 * the anchor). */
function isPrompt(a: ToolBlock, text: string): boolean {
  const p = isObj(a.input) && typeof a.input.prompt === "string" ? a.input.prompt.trim() : "";
  if (p) return text.includes(p);
  if (a.children.length > 0 || a.prompt) return false;
  a.prompt = text;
  return true;
}

/** Whether a call can still be running in the background after its turn:
 * a background agent's launch receipt or live task report. */
const backgroundLive = (t: ToolBlock): boolean => !!t.result?.async || (!!t.task && !TASK_TERMINAL.has(t.task.status));

/** Closes calls that will never get a result: those open when a later `ready`
 * ended their turn (`ended`), or every open call once the session is not
 * working (`halted`). Calls inside a live background agent, questions and
 * pending permissions still wait and are left alone. */
function settleOpen(blocks: readonly Block[], ended: ReadonlyMap<ToolBlock, number>, halted: boolean, inBackground = false): void {
  for (const b of blocks) {
    if (b.type !== "tool") continue;
    const waits = inBackground || b.permission?.status === "pending" || (ASKING_TOOLS.has(b.name) && !b.result);
    if (!b.result && !waits && (halted || ended.has(b))) {
      b.result = { output: undefined, isError: false, status: "interrupted", at: ended.get(b), interrupted: true };
    }
    settleOpen(b.children, ended, halted, inBackground || backgroundLive(b));
  }
}

/** `halted`: the session is known not to be working right now, so nothing
 * outside a background agent can still be running. */
export function buildView(state: ChatState, agentState: AgentState, halted = false): ChatView {
  const top: Block[] = [];
  const tools = new Map<string, ToolBlock>();
  /** Calls still open when a later top-level `ready` ended their turn. */
  const ended = new Map<ToolBlock, number>();
  /** Background agents by the task id of their launch receipt. */
  const tasks = new Map<string, ToolBlock>();
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

  /** Last model seen per thread ("" is the main thread, else the anchor id). */
  const models = new Map<string, string>();
  let model: string | undefined;

  const pushItem = (item: Placed, key: string, at: number) => {
    const meta = item.agentMetadata;
    const parentAnchor = item.parent ? anchor(item.parent, at) : undefined;
    const to = parentAnchor ? parentAnchor.children : top;
    switch (item.kind) {
      case "text":
        // An agent's first user row is its prompt, already on the card.
        if (item.role === "user" && parentAnchor && isPrompt(parentAnchor, item.text)) return;
        to.push(
          item.role === "user"
            ? { type: "user", key, text: item.text, ...(item.images ? { images: item.images } : {}), at }
            : { type: "text", key, text: item.text, at, ...(model ? { model } : {}) },
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
        if (!item.parent) for (const t of tools.values()) if (!t.result && !ended.has(t)) ended.set(t, at);
        return;
      case "tool-call": {
        const own = AGENT_TOOLS.has(item.name);
        const existing = tools.get(item.id);
        if (existing) {
          existing.input = mergeToolInput(existing.input, item.input);
          if (existing.synthetic) {
            existing.name = item.name;
            existing.at = at;
            delete existing.synthetic;
          } else if (!AGENT_TOOLS.has(existing.name) && item.name !== "tool") {
            existing.name = item.name;
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
          t.result = { output: item.output, isError: item.isError, status: item.status, at, ...(item.async ? { async: true as const } : {}) };
          if (item.async?.taskId) tasks.set(item.async.taskId, t);
          if (meta && AGENT_TOOLS.has(t.name)) {
            t.agentMetadata = meta;
            return;
          }
        } else {
          to.push({ type: "event", key, text: `Result for unknown tool call ${item.id.slice(0, 12)}`, at });
        }
        break;
      }
      case "task": {
        const t = (item.id && tools.get(item.id)) || (item.taskId && tasks.get(item.taskId)) || undefined;
        // A late progress tick never reopens an agent that already ended.
        if (t && !(t.task && TASK_TERMINAL.has(t.task.status))) t.task = { status: item.status, summary: item.summary ?? t.task?.summary, at };
        return;
      }
    }
    // A child row's metadata describes the thread it belongs to.
    if (meta && parentAnchor) parentAnchor.agentMetadata = meta;
  };

  for (const m of state.messages) {
    model = m.norm.model;
    if (model) {
      const parent = m.norm.items.find((i) => (i as Placed).parent)?.parent as string | undefined;
      const thread = parent ?? "";
      const prev = models.get(thread);
      if (prev !== undefined && modelKey(prev) !== modelKey(model)) {
        (parent ? anchor(parent, m.createdAt).children : top).push({ type: "model", key: `model:${m.id}`, from: prev, to: model, at: m.createdAt });
      }
      models.set(thread, model);
    }
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
  settleOpen(top, ended, halted);

  return { blocks: [...withDays(groupTurns(groupSteps(top), turnOpen)), ...orphans], turnOpen };
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
    a.prompt === b.prompt &&
    (a.task === b.task || (!!a.task && !!b.task && a.task.status === b.task.status && a.task.summary === b.task.summary && a.task.at === b.task.at)) &&
    (ar === br ||
      (!!ar && !!br && ar.output === br.output && ar.isError === br.isError && ar.status === br.status && ar.at === br.at && ar.async === br.async && ar.interrupted === br.interrupted)) &&
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
  if (a.type === "work") {
    const w = b as typeof a;
    return a.from === w.from && a.to === w.to && sameList(a.items, w.items);
  }
  const ao = a as unknown as Record<string, unknown>;
  const bo = b as unknown as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  return ak.every((k) => ao[k] === bo[k]);
}

/** Claude reports `[1m]`-style context markers on some ids but not others. */
const modelKey = (m: string) => m.trim().toLowerCase().replace(/\[[^\]]*\]$/, "");

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function mergeToolInput(prev: unknown, next: unknown): unknown {
  if (next === undefined) return prev;
  if (isObj(prev) && isObj(next)) {
    if (Object.keys(next).length === 0) return prev;
    return { ...prev, ...next };
  }
  return next;
}
