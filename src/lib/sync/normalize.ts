// Turns one decrypted message record into flat, typed items. Mirrors the
// subset of happy_flutter's message_processor.dart handlers this client
// renders: Claude `output`, `codex`, `acp`/`opencode`/`grok`, `event`, the
// `session` protocol and user text. Anything else becomes an `unknown` item
// (shown collapsed) rather than being dropped silently.

export type Item =
  | { kind: "text"; role: "user" | "agent"; text: string; streamId?: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool-call"; id: string; name: string; input: unknown; agentId?: string }
  | { kind: "tool-result"; id: string; output: unknown; isError: boolean }
  | { kind: "event"; text: string }
  | { kind: "ready" }
  | { kind: "unknown"; type: string };

/** An item plus the Agent anchor (tool-call id) it belongs under, if any. */
export type Placed = Item & { parent?: string };

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

/** wire_parsers.dart: parent id and sidechain flags. */
function parentOf(o: Obj): string | undefined {
  const p = first(o, "parent_tool_use_id", "parentToolUseId", "parent_toolUseId");
  if (p) return p;
  const sidechain = o.isSidechain === true || o.is_sidechain === true;
  return sidechain ? first(o, "parentUuid") : undefined;
}

function place(items: Item[], parent: string | undefined): Placed[] {
  return parent ? items.map((i) => ({ ...i, parent })) : items;
}

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
          items.push({ kind: "tool-call", id: b.id as string, name: s(b.name) ?? "tool", input: b.input });
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
    case "system":
      break;
    default:
      items.push({ kind: "unknown", type: `output/${String(data.type)}` });
  }
  return place(items, parent);
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
      input: src.input ?? src.args ?? src.arguments ?? src.rawInput,
    };
    const input = isObj(item.input) ? item.input : undefined;
    const agentId = input && s(input.agentId);
    if (item.name === "Agent" && agentId) item.agentId = agentId;
    return item;
  }
  if (t === "tool-call-result" || t === "tool-result" || t === "tool_result") {
    const id = first(data, "callId", "toolCallId", "tool_use_id", "id");
    if (!id) return undefined;
    return {
      kind: "tool-result",
      id,
      output: data.output ?? data.result ?? data.content,
      isError: data.isError === true || data.is_error === true || data.status === "failed",
    };
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
  return item ? place([item], parent) : [];
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
      return id ? place([{ kind: "tool-result", id, output: ev.result, isError: false }], parent) : [];
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
