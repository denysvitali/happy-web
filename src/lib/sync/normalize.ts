// Turns one decrypted message record into flat, typed items. Mirrors the
// subset of happy_flutter's message_processor.dart handlers this client
// renders: Claude `output`, `codex`, `acp`/`opencode`/`grok`, `event`, the
// `session` protocol and user text. Anything else becomes an `unknown` item
// (shown collapsed) rather than being dropped silently.

/** Child-thread settings reported by the agent (model, role, effort…). A
 * present map replaces the previous snapshot; `{}` clears it. Never filled
 * from coordinator defaults. */
export type AgentMetadata = Record<string, unknown>;

export type Item =
  | { kind: "text"; role: "user" | "agent"; text: string; streamId?: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool-call"; id: string; name: string; input: unknown; agentId?: string }
  | {
      kind: "tool-result";
      id: string;
      output: unknown;
      isError: boolean;
      /** Reported terminal status (`completed`, `failed`, `unknown`, …). */
      status?: string;
    }
  | { kind: "event"; text: string }
  | { kind: "ready" }
  | { kind: "unknown"; type: string };

/** An item plus the Agent anchor (tool-call id) it belongs under, if any,
 * and the child-thread metadata snapshot carried on its row. */
export type Placed = Item & { parent?: string; agentMetadata?: AgentMetadata };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const s = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const first = (o: Obj, ...keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = s(o[k]);
    if (v) return v;
  }
  return undefined;
};

/** wire_parsers.dart: the Agent anchor (tool-call id) a row belongs under.
 * Only explicit tool ids count: a bare sidechain `parentUuid` chains to the
 * previous transcript row, not to an anchor. */
function parentOf(o: Obj): string | undefined {
  return first(o, "parent_tool_use_id", "parentToolUseId", "parent_toolUseId");
}

function metadataOf(o: Obj): AgentMetadata | undefined {
  return isObj(o.agentMetadata) ? o.agentMetadata : undefined;
}

function place(items: Item[], parent: string | undefined, agentMetadata?: AgentMetadata): Placed[] {
  if (!parent && !agentMetadata) return items;
  return items.map((i) => {
    const p: Placed = { ...i };
    if (parent) p.parent = parent;
    if (agentMetadata) p.agentMetadata = agentMetadata;
    return p;
  });
}

/** Tool arguments sometimes arrive as a JSON string (Responses-style). */
function toolInput(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return v;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return v;
  }
}

const FAILED = new Set(["failed", "error", "interrupted", "cancelled", "canceled"]);

function blocksText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isObj)
    .map((b) => (b.type === "text" ? (s(b.text) ?? "") : ""))
    .filter(Boolean)
    .join("\n");
}

// ---- Claude `output` (stream-json SDK messages) ---------------------------

function claudeOutput(data: Obj): Placed[] {
  const parent = parentOf(data);
  const msg = isObj(data.message) ? data.message : undefined;
  const items: Item[] = [];
  switch (data.type) {
    case "assistant": {
      const content = Array.isArray(msg?.content) ? msg.content : [];
      for (const b of content) {
        if (!isObj(b)) continue;
        if (b.type === "text" && s(b.text)) items.push({ kind: "text", role: "agent", text: b.text as string });
        else if (b.type === "thinking" && s(b.thinking)) items.push({ kind: "thinking", text: b.thinking as string });
        else if (["tool_use", "server_tool_use", "mcp_tool_use", "toolCall"].includes(String(b.type)) && s(b.id))
          items.push({ kind: "tool-call", id: b.id as string, name: s(b.name) ?? "tool", input: toolInput(b.input) });
      }
      break;
    }
    case "user": {
      const content = msg?.content;
      if (typeof content === "string") {
        if (content) items.push({ kind: "text", role: "user", text: content });
        break;
      }
      if (!Array.isArray(content)) break;
      for (const b of content) {
        if (!isObj(b)) continue;
        if (b.type === "text" && s(b.text)) items.push({ kind: "text", role: "user", text: b.text as string });
        else if (b.type === "tool_result") {
          const id = first(b, "tool_use_id");
          if (id) items.push({ kind: "tool-result", id, output: b.content, isError: b.is_error === true });
        }
      }
      break;
    }
    case "message": {
      const text = s(data.message) ?? s(data.text);
      if (text) items.push({ kind: "text", role: "agent", text });
      break;
    }
    case "result":
      if (data.is_error === true) items.push({ kind: "event", text: s(data.result) ?? "Turn failed" });
      break;
    case "rate_limit_event": {
      const status = isObj(data.rate_limit_info) ? data.rate_limit_info.status : undefined;
      if (status === "rejected") items.push({ kind: "event", text: "Rate limit reached: waiting for reset" });
      else if (status === "allowed_warning") items.push({ kind: "event", text: "Approaching rate limit" });
      break;
    }
    case "error": {
      const e = isObj(data.error) ? data.error : data;
      items.push({ kind: "event", text: s(e.message) ?? s(data.message) ?? "Agent error" });
      break;
    }
    // Progress ticks and SDK bookkeeping: the tool row already shows a live
    // timer (happy_flutter hides these too).
    case "system":
    case "tool_progress":
    case "tool_use_summary":
    case "streamlined_tool_use_summary":
    case "auth_status":
    case "prompt_suggestion":
    case "stream_event":
      break;
    default:
      items.push({ kind: "unknown", type: `output/${String(data.type)}` });
  }
  return place(items, parent, metadataOf(data));
}

// ---- Codex / ACP style events ---------------------------------------------

function toolEvent(data: Obj): Item | undefined {
  const t = String(data.type);
  if (t === "tool-call" || t === "tool_call" || t === "toolCall") {
    const src = isObj(data.toolCall) ? data.toolCall : data;
    const id = first(src, "callId", "toolCallId", "tool_call_id", "id");
    if (!id) return undefined;
    const item: Item = {
      kind: "tool-call",
      id,
      name: first(src, "name", "toolName", "title") ?? "tool",
      input: toolInput(src.input ?? src.args ?? src.arguments ?? src.rawInput),
    };
    const input = isObj(item.input) ? item.input : undefined;
    const agentId = input && s(input.agentId);
    if (item.name === "Agent" && agentId) item.agentId = agentId;
    return item;
  }
  if (t === "tool-call-result" || t === "tool-result" || t === "tool_result") {
    const id = first(data, "callId", "toolCallId", "tool_use_id", "id");
    if (!id) return undefined;
    const output = data.output ?? data.result ?? data.content;
    // Codex child threads report `{result: {status}}`; nested sessions and Har
    // report a top-level `status`.
    const status = s(data.status) ?? (isObj(output) ? s(output.status) : undefined);
    const item: Item = {
      kind: "tool-result",
      id,
      output,
      isError: data.isError === true || data.is_error === true || (status !== undefined && FAILED.has(status)),
    };
    if (status) item.status = status;
    return item;
  }
  return undefined;
}

function codexLike(data: Obj): Placed[] {
  const parent = s(data.parentToolUseId) ?? s(data.parent_tool_use_id);
  const t = String(data.type);
  let item: Item | undefined;
  switch (t) {
    case "message":
    case "reasoning":
    case "model-output":
    case "agent_message_chunk": {
      const text = s(data.fullText) ?? s(data.message) ?? s(data.text);
      if (!text) return [];
      if (t === "reasoning") item = { kind: "thinking", text };
      else {
        item = { kind: "text", role: "agent", text };
        const streamId = s(data.streamId);
        if (streamId && streamId.length <= 128) item.streamId = streamId;
      }
      break;
    }
    case "thinking":
    case "agent_thought_chunk": {
      const text = s(data.text) ?? s(data.thinking) ?? s(data.message);
      if (text) item = { kind: "thinking", text };
      break;
    }
    case "token_count":
    case "task_started":
    case "task_complete":
    case "turn_aborted":
      return [];
    default:
      item = toolEvent(data) ?? { kind: "unknown", type: t };
  }
  return item ? place([item], parent, metadataOf(data)) : [];
}

// ---- events / session protocol --------------------------------------------

const SILENT_EVENTS = new Set(["thinking", "usage_report", "tool-execution-update"]);

function agentEvent(data: Obj): Placed[] {
  const t = String(data.type);
  if (t === "ready") return [{ kind: "ready" }];
  if (SILENT_EVENTS.has(t)) return [];
  const text = s(data.message) ?? s(data.text) ?? t.replace(/[-_]/g, " ");
  return [{ kind: "event", text }];
}

function sessionProtocol(ev: Obj): Placed[] {
  const parent = s(ev.subagent) ?? s(ev.parentUuid);
  switch (ev.t) {
    case "turn-end":
      return [{ kind: "ready" }];
    case "text": {
      const text = s(ev.text);
      if (!text) return [];
      return place([ev.thinking === true ? { kind: "thinking", text } : { kind: "text", role: "agent", text }], parent);
    }
    case "tool-call-start": {
      const id = s(ev.call);
      return id ? place([{ kind: "tool-call", id, name: s(ev.name) ?? "tool", input: ev.args }], parent) : [];
    }
    case "tool-call-end": {
      const id = s(ev.call);
      return id ? place([{ kind: "tool-result", id, output: ev.result, isError: ev.isError === true || ev.error === true }], parent) : [];
    }
    default:
      return [];
  }
}

export interface Normalized {
  role: "user" | "agent";
  items: Placed[];
}

export function normalizeRecord(record: unknown): Normalized {
  if (!isObj(record)) return { role: "agent", items: [{ kind: "unknown", type: "malformed" }] };
  if (record.role === "user") {
    const c = record.content;
    const meta = isObj(record.meta) ? record.meta : {};
    const text = s(meta.displayText) ?? (isObj(c) && c.type === "text" ? (s(c.text) ?? "") : blocksText(c));
    return { role: "user", items: text ? [{ kind: "text", role: "user", text }] : [] };
  }
  if (record.role === "session") {
    const ev = isObj(record.ev) ? record.ev : isObj(record.event) ? record.event : undefined;
    return { role: "agent", items: ev ? sessionProtocol(ev) : [] };
  }
  const content = isObj(record.content) ? record.content : undefined;
  const data = content && isObj(content.data) ? content.data : undefined;
  if (!content || !data) return { role: "agent", items: [{ kind: "unknown", type: "malformed" }] };
  switch (content.type) {
    case "output":
      return { role: "agent", items: claudeOutput(data) };
    case "codex":
    case "acp":
    case "opencode":
    case "grok":
      return { role: "agent", items: codexLike(data) };
    case "event":
      return { role: "agent", items: agentEvent(data) };
    default:
      return { role: "agent", items: [{ kind: "unknown", type: String(content.type) }] };
  }
}
