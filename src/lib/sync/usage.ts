// Account usage limits (machine RPCs `get-claude-usage-limits` /
// `get-codex-usage`) and per-session context usage derived from raw
// decrypted message records. Pure; mirrors happy_flutter's
// claude_usage_limits.dart / codex_usage_summary.dart.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const clampPct = (v: number) => Math.min(100, Math.max(0, v));

export type UsageProvider = "claude" | "codex";

/** Usage limits exist only for Claude (flavor `claude` or unset) and Codex. */
export function usageProvider(flavor: string | undefined): UsageProvider | null {
  if (!flavor || flavor === "claude") return "claude";
  if (flavor === "codex") return "codex";
  return null;
}

export interface UsageWindow {
  label: string;
  /** 0–100. */
  percent: number;
  /** Epoch ms. */
  resetsAt?: number | undefined;
}

export interface UsageSummary {
  provider: UsageProvider;
  /** Most important first: the header pill shows `windows[0]`. */
  windows: UsageWindow[];
  limitReached?: boolean;
  /** Short facts for the popover footer ("Plan: Plus", "Credits: 12.50"). */
  facts: string[];
}

function isoMs(v: unknown): number | undefined {
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : t;
}

const CLAUDE_WINDOWS: [string, string][] = [
  ["five_hour", "5-Hour"],
  ["seven_day", "7-Day"],
  ["seven_day_sonnet", "7-Day Sonnet"],
  ["seven_day_opus", "7-Day Opus"],
  ["seven_day_oauth_apps", "7-Day OAuth"],
  ["seven_day_cowork", "7-Day Cowork"],
];

function limitGroupLabel(group: string): string {
  if (group === "session") return "5-Hour";
  if (group === "weekly") return "7-Day";
  return group ? group[0]!.toUpperCase() + group.slice(1) : group;
}

const dollars = (n: number) => `$${n.toFixed(2)}`;

/** `get-claude-usage-limits` → `{success, data: "<json>", error}`. */
export function parseClaudeUsage(res: unknown): UsageSummary | null {
  if (!isObj(res) || res.success !== true) return null;
  let data: unknown = res.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  if (!isObj(data)) return null;
  const windows: UsageWindow[] = [];
  for (const [key, label] of CLAUDE_WINDOWS) {
    const w = data[key];
    if (!isObj(w)) continue;
    windows.push({ label, percent: clampPct(num(w.utilization) ?? 0), resetsAt: isoMs(w.resets_at) });
  }
  const seen = new Set(windows.map((w) => w.label.toLowerCase()));
  if (Array.isArray(data.limits)) {
    for (const l of data.limits) {
      if (!isObj(l)) continue;
      const model = isObj(l.scope) && isObj(l.scope.model) ? str(l.scope.model.display_name) : undefined;
      if (!model) continue;
      const label = `${limitGroupLabel(str(l.group) ?? "")} ${model}`.trim();
      if (seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      windows.push({ label, percent: clampPct(num(l.percent) ?? 0), resetsAt: isoMs(l.resets_at) });
    }
  }
  const facts: string[] = [];
  const extra = data.extra_usage;
  if (isObj(extra) && extra.is_enabled === true) {
    const used = num(extra.used_credits);
    const limit = num(extra.monthly_limit);
    if (used !== undefined && limit !== undefined) facts.push(`Extra usage: ${dollars(used)} of ${dollars(limit)}`);
    else if (used !== undefined) facts.push(`Extra usage: ${dollars(used)}`);
    else facts.push("Extra usage enabled");
  }
  if (windows.length === 0 && facts.length === 0) return null;
  return { provider: "claude", windows, facts, limitReached: windows.some((w) => w.percent >= 100) };
}

function windowLabel(seconds: number | undefined, fallback: string): string {
  if (seconds === 18_000) return "5-Hour";
  if (seconds === 604_800) return "7-Day";
  if (!seconds || seconds <= 0) return fallback;
  if (seconds % 86_400 === 0) return `${seconds / 86_400}-Day`;
  if (seconds % 3600 === 0) return `${seconds / 3600}-Hour`;
  return `${Math.round(seconds / 60)}-Min`;
}

function codexWindow(w: unknown, fallback: string, now: number): UsageWindow | null {
  if (!isObj(w)) return null;
  const resetAt = num(w.reset_at);
  const after = num(w.reset_after_seconds);
  return {
    label: windowLabel(num(w.limit_window_seconds), fallback),
    percent: clampPct(num(w.used_percent) ?? 0),
    resetsAt: resetAt !== undefined ? resetAt * 1000 : after !== undefined ? now + after * 1000 : undefined,
  };
}

const titleCase = (s: string) => s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** `get-codex-usage` → `{success, data: {rate_limit, credits, plan_type}, error}`. */
export function parseCodexUsage(res: unknown, now = Date.now()): UsageSummary | null {
  if (!isObj(res) || res.success !== true || !isObj(res.data)) return null;
  const d = res.data;
  const rl = isObj(d.rate_limit) ? d.rate_limit : {};
  const windows = [codexWindow(rl.primary_window, "Primary", now), codexWindow(rl.secondary_window, "Secondary", now)].filter(
    (w): w is UsageWindow => w !== null,
  );
  const facts: string[] = [];
  const plan = str(d.plan_type);
  if (plan) facts.push(`Plan: ${titleCase(plan)}`);
  const c = d.credits;
  if (isObj(c)) {
    if (c.unlimited === true) facts.push("Credits: unlimited");
    else if (c.has_credits === true) {
      const bal = typeof c.balance === "number" ? String(c.balance) : str(c.balance);
      facts.push(bal ? `Credits: ${bal}` : "Credits available");
    }
  }
  if (windows.length === 0 && facts.length === 0) return null;
  return { provider: "codex", windows, facts, limitReached: rl.limit_reached === true || rl.allowed === false };
}

/** "resets in 2h 14m", "resets in 3d 4h", "resets soon". */
export function formatResetIn(resetsAt: number | undefined, now: number): string | undefined {
  if (resetsAt === undefined) return undefined;
  const mins = Math.round((resetsAt - now) / 60_000);
  if (mins <= 0) return "resets soon";
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `resets in ${d}d${h ? ` ${h}h` : ""}`;
  if (h > 0) return `resets in ${h}h${m ? ` ${m}m` : ""}`;
  return `resets in ${m}m`;
}

/** ok < 80%, warn ≥ 80%, critical ≥ 95% of a limit used. */
export function usageLevel(percent: number): "ok" | "warn" | "critical" {
  if (percent >= 95) return "critical";
  if (percent >= 80) return "warn";
  return "ok";
}

// ---- per-session context ------------------------------------------------------

export interface ContextUsage {
  /** Tokens currently in the context window. */
  used: number;
  /** Window size reported by the agent, if any. */
  window?: number | undefined;
  /** Model reported alongside the usage, if any. */
  model?: string | undefined;
}

function fromUsage(u: unknown, model?: string): ContextUsage | null {
  if (!isObj(u)) return null;
  const size = num(u.context_size);
  const parts = [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens].map(num);
  const used = size ?? (parts.some((p) => p !== undefined) ? parts.reduce<number>((a, p) => a + (p ?? 0), 0) : undefined);
  if (used === undefined) return null;
  const window = num(u.context_window);
  return { used, window: window && window > 0 ? window : undefined, model: str(u.model) ?? model };
}

/** The context usage a raw decrypted record reports, or null. Sidechain
 * (child agent) rows are ignored: their context is not the session's. */
export function contextUsageOf(record: unknown): ContextUsage | null {
  if (!isObj(record) || record.role !== "agent" || !isObj(record.content)) return null;
  const { type, data } = record.content;
  if (!isObj(data)) return null;
  if (data.isSidechain === true || str(data.parent_tool_use_id) || str(data.parentToolUseId)) return null;
  switch (type) {
    case "output": {
      if (data.type !== "assistant" || !isObj(data.message)) return null;
      return fromUsage(data.message.usage, str(data.message.model));
    }
    case "codex": {
      const msg = isObj(data.message) ? data.message : undefined;
      return fromUsage(data.usage ?? msg?.usage, str(data.model) ?? str(msg?.model));
    }
    case "acp":
      return data.type === "usage" ? fromUsage(data.usage) : null;
    default:
      return null;
  }
}

/** Default context window when the agent does not report one. */
export function defaultContextWindow(model: string | undefined): number {
  const m = (model ?? "").toLowerCase();
  if (m.endsWith("[1m]")) return 1_000_000;
  if ((m.includes("claude") || /^(opus|sonnet|haiku|fable)\b/.test(m)) && m.includes("1m")) return 1_000_000;
  if (/^gpt-(4\.1|5)/.test(m) || /gemini-(2\.5|3)/.test(m)) return 1_000_000;
  if (/^o[34]\b/.test(m) || /^o[34]-/.test(m)) return 200_000;
  return 190_000;
}

export type ContextLevel = "ok" | "warn" | "critical";

export interface ContextMeter {
  used: number;
  window: number;
  /** 0–1, clamped. */
  fraction: number;
  level: ContextLevel;
}

/** Warn at ≤15% remaining, critical at ≤5%. `fallbackModel` is the
 * session's selected model, used when the usage row names none. */
export function contextMeter(u: ContextUsage, fallbackModel?: string): ContextMeter {
  // The selection's `[1m]` marker is not in the reported model id, so take
  // the larger of both defaults.
  const window = u.window ?? Math.max(defaultContextWindow(u.model), defaultContextWindow(fallbackModel));
  const fraction = Math.min(1, Math.max(0, u.used / window));
  const remaining = Math.max(0, window - u.used) / window;
  const level: ContextLevel = remaining <= 0.05 ? "critical" : remaining <= 0.15 ? "warn" : "ok";
  return { used: u.used, window, fraction, level };
}

/** 950 → "950", 62_400 → "62k", 1_250_000 → "1.25M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${n < 10_000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") : Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}
