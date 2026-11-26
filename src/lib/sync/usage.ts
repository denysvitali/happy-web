// Account usage limits (machine RPCs `get-claude-usage-limits` /
// `get-codex-usage` / `get-agy-usage`), server usage reports
// (`POST /v1/usage/query`), and per-session context usage derived from raw
// decrypted message records. Pure; mirrors happy_flutter's
// claude_usage_limits.dart / codex_usage_summary.dart.
import type { UsageQueryResponse } from "../api/schemas";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const clampPct = (v: number) => Math.min(100, Math.max(0, v));

export type UsageProvider = "claude" | "codex" | "agy";

/** Usage limits exist for Claude (flavor `claude` or unset), Codex, and Antigravity. */
export function usageProvider(flavor: string | undefined): UsageProvider | null {
  if (!flavor || flavor === "claude") return "claude";
  if (flavor === "codex") return "codex";
  if (flavor === "agy" || flavor === "antigravity") return "agy";
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

function agyGroupShortName(name: string | undefined): string {
  if (!name) return "";
  const lower = name.toLowerCase();
  if (lower.includes("claude") && lower.includes("gpt")) return "Claude & GPT";
  if (lower.includes("gemini")) return "Gemini";
  return name.replace(/\s+models$/i, "").trim();
}

function agyWindowLabel(window: string | undefined, displayName: string | undefined, groupName: string): string {
  const base =
    window === "5h"
      ? "5-Hour"
      : window === "weekly"
        ? "7-Day"
        : displayName?.replace(/\s+Limit\s+Remaining$/i, "").trim() || window || "Quota";
  return groupName ? `${base} ${groupName}` : base;
}

/** `get-agy-usage` → `{success, data: {tier, groups, buckets}, error}`. */
export function parseAgyUsage(res: unknown): UsageSummary | null {
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

  // Per-model buckets give Gemini usage and reset timestamps (which summary
  // groups sometimes omit for 5-hour windows).
  const rawBuckets = Array.isArray(data.buckets) ? data.buckets.filter(isObj) : [];
  let geminiMinRem: number | undefined;
  let geminiReset: number | undefined;
  let thirdPartyMinRem: number | undefined;
  let thirdPartyReset: number | undefined;

  for (const b of rawBuckets) {
    const modelId = (str(b.modelId) ?? "").toLowerCase();
    const rem = num(b.remainingFraction);
    if (rem === undefined) continue;
    const reset = isoMs(b.resetTime);
    if (modelId.startsWith("gemini-")) {
      if (geminiMinRem === undefined || rem < geminiMinRem) geminiMinRem = rem;
      if (reset !== undefined && (geminiReset === undefined || reset < geminiReset)) geminiReset = reset;
    } else if (modelId.startsWith("claude-") || modelId.startsWith("gpt-")) {
      if (thirdPartyMinRem === undefined || rem < thirdPartyMinRem) thirdPartyMinRem = rem;
      if (reset !== undefined && (thirdPartyReset === undefined || reset < thirdPartyReset)) thirdPartyReset = reset;
    }
  }

  const windows: UsageWindow[] = [];
  const seen = new Set<string>();
  let hasGeminiGroup = false;

  if (Array.isArray(data.groups)) {
    for (const g of data.groups) {
      if (!isObj(g) || !Array.isArray(g.buckets)) continue;
      const groupName = agyGroupShortName(str(g.displayName));
      if (groupName.toLowerCase().includes("gemini")) hasGeminiGroup = true;
      // Put 5-hour windows before weekly windows so the shorter window leads on ties.
      const sorted = [...g.buckets].filter(isObj).sort((a, b) => {
        const rank = (w: unknown) => (w === "5h" ? 0 : w === "weekly" ? 1 : 2);
        return rank(a.window) - rank(b.window);
      });
      for (const b of sorted) {
        const rem = num(b.remainingFraction);
        if (rem === undefined) continue;
        const win = str(b.window);
        const label = agyWindowLabel(win, str(b.displayName), groupName);
        if (seen.has(label.toLowerCase())) continue;
        seen.add(label.toLowerCase());
        let resetsAt = isoMs(b.resetTime);
        if (resetsAt === undefined && win === "5h" && groupName === "Claude & GPT") resetsAt = thirdPartyReset;
        windows.push({ label, percent: clampPct((1 - rem) * 100), resetsAt });
      }
    }
  }

  if (!hasGeminiGroup && geminiMinRem !== undefined) {
    windows.push({ label: "Gemini", percent: clampPct((1 - geminiMinRem) * 100), resetsAt: geminiReset });
  }
  if (windows.length === 0 && thirdPartyMinRem !== undefined) {
    windows.push({ label: "Claude & GPT", percent: clampPct((1 - thirdPartyMinRem) * 100), resetsAt: thirdPartyReset });
  }

  const facts: string[] = [];
  const tier = str(data.tier);
  if (tier) facts.push(`Plan: ${tier}`);
  if (windows.length === 0 && facts.length === 0) return null;
  return { provider: "agy", windows, facts, limitReached: windows.some((w) => w.percent >= 100) };
}

export interface UsageReportBucket {
  /** Epoch ms. */
  timestamp: number;
  tokens: number;
  cost: number;
  reportCount: number;
}

export interface UsageReportSummary {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCost: number;
  totalReports: number;
  buckets: UsageReportBucket[];
}

/** Aggregates `POST /v1/usage/query` buckets into period totals and a sorted timeline. */
export function summarizeUsageReports(res: UsageQueryResponse): UsageReportSummary {
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let totalCost = 0;
  const buckets: UsageReportBucket[] = [];

  for (const pt of res.usage) {
    const inp = pt.tokens.input ?? 0;
    const out = pt.tokens.output ?? 0;
    const cacheRead = pt.tokens.cache_read ?? 0;
    const cacheCreate = pt.tokens.cache_creation ?? 0;
    const ptTotal = pt.tokens.total ?? inp + out + cacheRead + cacheCreate;
    const ptCost = pt.cost.total ?? (pt.cost.input ?? 0) + (pt.cost.output ?? 0);
    totalTokens += ptTotal;
    inputTokens += inp;
    outputTokens += out;
    cacheReadTokens += cacheRead;
    cacheCreationTokens += cacheCreate;
    totalCost += ptCost;
    buckets.push({
      timestamp: pt.timestamp * 1000,
      tokens: ptTotal,
      cost: ptCost,
      reportCount: pt.reportCount,
    });
  }
  buckets.sort((a, b) => a.timestamp - b.timestamp);
  return {
    totalTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalCost,
    totalReports: res.totalReports,
    buckets,
  };
}

/** Formats a USD amount compactly ("$0.00", "<$0.01", "$1.25"). */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.005) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/** "resets in 2h 14m", "resets in 3d 4h", "resets soon". */
/** The window closest to its limit (first wins ties): what the toolbar shows. */
export function headlineWindow(u: UsageSummary): UsageWindow | undefined {
  let best: UsageWindow | undefined;
  for (const w of u.windows) if (!best || w.percent > best.percent) best = w;
  return best;
}

/** "5-Hour" → "5h", "7-Day Opus" → "7d", "30-Min" → "30m"; else the label. */
export function shortWindowLabel(label: string): string {
  const m = /^(\d+)-(Hour|Day|Min)/i.exec(label);
  return m ? `${m[1]}${m[2]![0]!.toLowerCase()}` : label;
}

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

/** Context windows Claude reports per model on its `result` record
 * (`modelUsage[model].contextWindow`): the authoritative size, including
 * 1M tiers and gateway overrides. Sidechain results are ignored. */
export function reportedWindowsOf(record: unknown): Record<string, number> | null {
  if (!isObj(record) || record.role !== "agent" || !isObj(record.content)) return null;
  const { type, data } = record.content;
  if (type !== "output" || !isObj(data) || data.type !== "result" || !isObj(data.modelUsage)) return null;
  if (data.isSidechain === true || str(data.parent_tool_use_id)) return null;
  const out: Record<string, number> = {};
  for (const [model, u] of Object.entries(data.modelUsage)) {
    const w = isObj(u) ? num(u.contextWindow) : undefined;
    if (w && w > 0) out[model] = w;
  }
  return Object.keys(out).length ? out : null;
}

const modelKey = (m: string) => m.trim().toLowerCase().replace(/\[1m\]$/, "");

/** The reported window for `model`: exact id, then a containing id; with no
 * model to match, the largest (the main model outsizes its helpers). */
function reportedFor(reported: Record<string, number> | undefined, model: string | undefined): number | undefined {
  if (!reported) return undefined;
  const entries = Object.entries(reported).map(([k, w]) => [modelKey(k), w] as const);
  if (entries.length === 0) return undefined;
  if (model) {
    const m = modelKey(model);
    const hit = entries.find(([k]) => k === m) ?? entries.find(([k]) => k.includes(m) || m.includes(k));
    if (hit) return hit[1];
  }
  return Math.max(...entries.map(([, w]) => w));
}

/** Assumed when nobody reports or configures a window. */
const ASSUMED_WINDOW = 190_000;

/** A known window for model ids that carry it (happy_flutter
 * defaultContextWindowForModel), else undefined. */
export function knownContextWindow(model: string | undefined): number | undefined {
  const m = (model ?? "").trim().toLowerCase().split("/").pop() ?? "";
  if (!m) return undefined;
  if (m.endsWith("[1m]")) return 1_000_000;
  if ((m.includes("claude") || /^(opus|sonnet|haiku|fable)\b/.test(m)) && m.includes("1m")) return 1_000_000;
  if (/^grok-4\.[5-9]/.test(m)) return 500_000;
  if (/^gemini-(2\.5|3|4)/.test(m) || /^gpt-(4\.1|5)/.test(m)) return 1_000_000;
  if (/^o[34](\b|-)/.test(m) || /^(minimax-m3|kimi-k2)/.test(m)) return 200_000;
  return undefined;
}

/** Default context window when the agent does not report one. */
export function defaultContextWindow(model: string | undefined): number {
  return knownContextWindow(model) ?? ASSUMED_WINDOW;
}

export type ContextLevel = "ok" | "warn" | "critical";
/** Where the window size came from, for the meter's explanation. */
export type WindowSource = "reported" | "profile" | "model" | "assumed";

export interface ContextMeter {
  used: number;
  window: number;
  source: WindowSource;
  /** 0–1, clamped. */
  fraction: number;
  level: ContextLevel;
}

export interface WindowHints {
  /** Per-model windows Claude reported (`reportedWindowsOf`). */
  reported?: Record<string, number> | undefined;
  /** The provider profile's window for the session's model. */
  profile?: number | undefined;
}

/** Warn at ≤15% remaining, critical at ≤5%. The window comes from, in
 * order: the usage row, Claude's reported window for the model, the
 * provider profile, a known model default, then a conservative budget.
 * `fallbackModel` is the session's selected model, used when the usage row
 * names none. */
export function contextMeter(u: ContextUsage, fallbackModel?: string, hints: WindowHints = {}): ContextMeter {
  const model = u.model ?? fallbackModel;
  let window: number | undefined = u.window;
  let source: WindowSource = "reported";
  if (!window) window = reportedFor(hints.reported, model);
  if (!window && hints.profile && hints.profile > 0) {
    window = hints.profile;
    source = "profile";
  }
  if (!window) {
    // The selection's `[1m]` marker is not in the reported model id: take the larger.
    const known = Math.max(knownContextWindow(u.model) ?? 0, knownContextWindow(fallbackModel) ?? 0);
    window = known || ASSUMED_WINDOW;
    source = known ? "model" : "assumed";
  }
  const fraction = Math.min(1, Math.max(0, u.used / window));
  const remaining = Math.max(0, window - u.used) / window;
  const level: ContextLevel = remaining <= 0.05 ? "critical" : remaining <= 0.15 ? "warn" : "ok";
  return { used: u.used, window, source, fraction, level };
}

/** 950 → "950", 62_400 → "62k", 1_250_000 → "1.25M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${n < 10_000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") : Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}
