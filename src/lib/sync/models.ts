// In-session model and permission-mode switching: picker catalogs per agent,
// selection strings and the user-message meta that carries a switch. Pure.
//
// Selection grammar (happy-cli-go splitClaudeModelSelection /
// SplitCodexModelSelection): `<model>[:<effort>][<context marker>]`, e.g.
// `opus`, `opus:high`, `opus:high[1m]`. Only a terminal known effort counts.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

export type AgentKind = "claude" | "codex" | "prime" | "opencode" | "agy" | "other";

export function agentKind(flavor: string | undefined): AgentKind {
  switch (flavor) {
    case undefined:
    case "":
    case "claude":
      return "claude";
    case "codex":
      return "codex";
    case "prime-agent":
      return "prime";
    case "opencode":
      return "opencode";
    case "agy":
    case "antigravity":
      return "agy";
    default:
      return "other";
  }
}

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];
const isEffort = (v: string): v is Effort => (EFFORTS as readonly string[]).includes(v);
const EFFORT_LABEL: Record<Effort, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
export const effortLabel = (e: string) => (isEffort(e) ? EFFORT_LABEL[e] : e);

/** "default" means "no change": it is sent as `model: null`. */
export const DEFAULT_MODEL = "default";

export function parseSelection(sel: string): { base: string; effort?: Effort } {
  let s = sel.trim();
  let marker = "";
  if (s.endsWith("]")) {
    const i = s.lastIndexOf("[");
    if (i > 0) {
      marker = s.slice(i);
      s = s.slice(0, i);
    }
  }
  const c = s.lastIndexOf(":");
  if (c > 0) {
    const effort = s.slice(c + 1);
    if (isEffort(effort)) return { base: s.slice(0, c) + marker, effort };
  }
  return { base: s + marker };
}

/** `withEffort("opus[1m]", "high")` → `opus:high[1m]`. */
export function withEffort(id: string, effort: string): string {
  const { base } = parseSelection(id);
  if (base.endsWith("]")) {
    const i = base.lastIndexOf("[");
    if (i > 0) return `${base.slice(0, i)}:${effort}${base.slice(i)}`;
  }
  return `${base}:${effort}`;
}

export interface ModelChoice {
  /** Selection string (Claude/Codex) or model id (Prime, OpenCode, Antigravity). */
  value: string;
  label: string;
}

export interface ModelGroup {
  id: string;
  label: string;
  description?: string | undefined;
  /** The base model, then its effort variants. */
  choices: ModelChoice[];
}

export interface Catalog {
  groups: ModelGroup[];
  /** Prime Agent only: efforts are chosen separately from the model. */
  efforts?: ModelChoice[];
  /** Non-fatal notice from the catalog source (Codex). */
  notice?: string | undefined;
}

function group(id: string, label: string, efforts: string[], description?: string): ModelGroup {
  return {
    id,
    label,
    description,
    choices: [{ value: id, label }, ...efforts.map((e) => ({ value: withEffort(id, e), label: `${label} · ${effortLabel(e)}` }))],
  };
}

const defaultGroup = (): ModelGroup => ({ id: DEFAULT_MODEL, label: "Default", choices: [{ value: DEFAULT_MODEL, label: "Default" }] });

const CLAUDE_TIERS: [string, string][] = [
  ["opus", "Opus"],
  ["sonnet", "Sonnet"],
  ["haiku", "Haiku"],
  ["fable", "Fable"],
];

/** `metadata.claudeModels` = `[{id, name, description?, efforts}]`; without a
 * catalog, the built-in tiers. */
export function claudeCatalog(raw: unknown[] | undefined): Catalog {
  const groups = [defaultGroup()];
  const seen = new Set([DEFAULT_MODEL]);
  const entries = Array.isArray(raw) ? raw.filter(isObj) : [];
  for (const m of entries) {
    const id = str(m.id);
    // The CLI's own "default" says what it resolves to ("Opus 5.5 · …").
    if (id === DEFAULT_MODEL) groups[0]!.description ??= str(m.description);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const efforts = Array.isArray(m.efforts) ? [...new Set(m.efforts.filter((e): e is Effort => typeof e === "string" && isEffort(e)))] : [];
    groups.push(group(id, str(m.name) ?? id, efforts, str(m.description)));
  }
  if (groups.length === 1) for (const [id, label] of CLAUDE_TIERS) groups.push(group(id, label, []));
  return { groups };
}

const HIDDEN = new Set(["hide", "hidden", "none"]);

/** `get-codex-models` → `{success, models, error?}`; `error` may be a notice
 * while `success` is true. */
export function codexCatalog(res: unknown): Catalog | null {
  if (!isObj(res) || res.success !== true || !Array.isArray(res.models)) return null;
  const groups = [defaultGroup()];
  const seen = new Set([DEFAULT_MODEL]);
  for (const m of res.models) {
    if (!isObj(m)) continue;
    const slug = str(m.slug);
    if (!slug || seen.has(slug)) continue;
    if (m.showInPicker === false || m.hidden === true || HIDDEN.has(String(m.visibility ?? "").toLowerCase())) continue;
    seen.add(slug);
    const levels = Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels : Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts : [];
    const efforts = [
      ...new Set(
        levels
          .map((l) => (typeof l === "string" ? l : isObj(l) ? str(l.effort) : undefined))
          .filter((e): e is Effort => typeof e === "string" && isEffort(e)),
      ),
    ];
    const def = str(m.default_reasoning_level) ?? str(m.defaultReasoningEffort);
    const label = str(m.display_name) ?? str(m.displayName) ?? slug;
    groups.push(group(slug, label, efforts, def && isEffort(def) ? `Default effort: ${effortLabel(def)}` : str(m.description)));
  }
  return { groups, notice: str(res.error) };
}

function idNameList(raw: unknown[] | undefined): ModelChoice[] {
  const out: ModelChoice[] = [];
  const seen = new Set<string>();
  for (const m of Array.isArray(raw) ? raw : []) {
    if (!isObj(m)) continue;
    const id = str(m.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ value: id, label: str(m.name) ?? id });
  }
  return out;
}

/** Prime Agent: model ids may contain colons, so efforts never ride in the
 * selection string; they are sent as `meta.reasoning_effort`. */
export function primeCatalog(models: unknown[] | undefined, efforts: unknown[] | undefined): Catalog {
  return {
    groups: idNameList(models).map((c) => ({ id: c.value, label: c.label, choices: [c] })),
    efforts: idNameList(efforts),
  };
}

/** OpenCode (`metadata.opencodeModels`) and Antigravity (`agyModels`): the
 * `{id, name}` list the agent advertises over ACP. */
export function listedCatalog(models: unknown[] | undefined): Catalog {
  return { groups: idNameList(models).map((c) => ({ id: c.value, label: c.label, choices: [c] })) };
}

/** `get-agy-models` → `{success, models: [{id, name}], error?}`; fetched from
 * the daemon so Antigravity models appear in New session and while a Pod is
 * still starting (before `metadata.agyModels` is written). */
export function agyCatalog(res: unknown): Catalog | null {
  if (!isObj(res) || res.success !== true || !Array.isArray(res.models)) return null;
  return { ...listedCatalog(res.models), notice: str(res.error) };
}

export function findChoice(catalog: Catalog, value: string): ModelChoice | undefined {
  for (const g of catalog.groups) {
    const c = g.choices.find((x) => x.value === value);
    if (c) return c;
  }
  return undefined;
}

/** Human label for a selection, even one the catalog does not list. */
export function selectionLabel(catalog: Catalog, sel: string | undefined): string {
  if (!sel || sel === DEFAULT_MODEL) return "Default";
  const hit = findChoice(catalog, sel);
  if (hit) return hit.label;
  const { base, effort } = parseSelection(sel);
  const baseLabel = catalog.groups.find((g) => g.id === base)?.label ?? base;
  return effort ? `${baseLabel} · ${effortLabel(effort)}` : baseLabel;
}

/** The picker chip: the selection, except where the transcript knows better.
 * "Default" shows the model that answers (`running`, the newest main-thread
 * `message.model`), and so does a concrete id the catalog does not offer:
 * such ids may be a stale guess (older daemons recorded `claude-sonnet-5-5`
 * for every Default spawn) and `running` is what actually answers. */
export function chipLabel(catalog: Catalog, sel: string, running: string | undefined): string {
  const actual = running && running !== "<synthetic>" ? (findChoice(catalog, running)?.label ?? modelLabel(running)) : undefined;
  if (!actual) return selectionLabel(catalog, sel);
  if (sel === DEFAULT_MODEL) return actual;
  const { base, effort } = parseSelection(sel);
  if (findChoice(catalog, sel) || catalog.groups.some((g) => g.id === base)) return selectionLabel(catalog, sel);
  return effort ? `${actual} · ${effortLabel(effort)}` : actual;
}

// ---- permission modes ---------------------------------------------------------

export interface PermissionModeOption {
  value: string;
  label: string;
  description: string;
  /** Rendered in red: the agent acts without asking. */
  danger?: boolean;
}

const CLAUDE_MODES: PermissionModeOption[] = [
  { value: "default", label: "Ask", description: "Ask before edits and commands" },
  { value: "acceptEdits", label: "Accept edits", description: "Apply file edits without asking" },
  { value: "plan", label: "Plan", description: "Read-only planning, no changes" },
  { value: "bypassPermissions", label: "Bypass", description: "Never ask; run everything", danger: true },
];

const CODEX_MODES: PermissionModeOption[] = [
  { value: "default", label: "Ask", description: "Ask before commands and edits" },
  { value: "read-only", label: "Read only", description: "Read-only sandbox, asks for more" },
  { value: "safe-yolo", label: "Safe YOLO", description: "Read-only sandbox, approvals off" },
  { value: "yolo", label: "YOLO", description: "Full access, approvals off", danger: true },
];

export function permissionModes(kind: AgentKind): PermissionModeOption[] {
  return kind === "codex" ? CODEX_MODES : CLAUDE_MODES;
}

/** The session's mode from metadata, falling back to `default` when it is
 * missing or not one this agent understands. */
export function currentPermissionMode(kind: AgentKind, mode: string | undefined): string {
  return mode && permissionModes(kind).some((m) => m.value === mode) ? mode : defaultPermissionMode(kind);
}

/** Bypass is the house default for every agent (Codex: YOLO). Other modes stay
 * selectable in the New session modal and the session toolbar. */
export function defaultPermissionMode(kind: string): string {
  return kind === "codex" ? "yolo" : "bypassPermissions";
}

// ---- send ---------------------------------------------------------------------

export interface Switch {
  /** Pending model selection, if the user picked one. */
  model?: string | undefined;
  /** Prime Agent reasoning effort, if the user picked one. */
  reasoningEffort?: string | undefined;
  permissionMode: string;
}

/** What `ChatStore.send` puts on the user message. `model: null` = no change. */
export interface SendOptions {
  model: string | null;
  permissionMode: string;
  reasoningEffort?: string | undefined;
}

/** Resolves a switch for sending. `default` and models the agent cannot
 * take become `model: null` ("no change"). */
export function sendOptions(kind: AgentKind, catalog: Catalog, sw: Switch): SendOptions {
  let model: string | null = sw.model && sw.model !== DEFAULT_MODEL ? sw.model : null;
  if (model && (kind === "opencode" || kind === "agy" || kind === "prime") && !findChoice(catalog, model)) model = null;
  if (kind === "other") model = null;
  const out: SendOptions = { model, permissionMode: sw.permissionMode };
  if (kind === "prime" && sw.reasoningEffort && catalog.efforts?.some((e) => e.value === sw.reasoningEffort)) {
    out.reasoningEffort = sw.reasoningEffort;
  }
  return out;
}

const CLAUDE_FAMILY = "(opus|sonnet|haiku|fable)";
const CLAUDE_NEW = new RegExp(`^claude-${CLAUDE_FAMILY}-(\\d+)(?:-(\\d))?(?:-\\d{8})?$`);
const CLAUDE_OLD = new RegExp(`^claude-(\\d+)(?:-(\\d))?-${CLAUDE_FAMILY}(?:-\\d{8})?$`);
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** A short name for a reported model id: `claude-opus-4-8-20260101` →
 * `Opus 4.8`. Anything else (GPT, provider/model ids) is shown as is. */
export function modelLabel(id: string): string {
  const raw = id.trim();
  const m = raw.toLowerCase().replace(/\[[^\]]*\]$/, "");
  let hit = CLAUDE_NEW.exec(m);
  if (hit) return `${cap(hit[1]!)} ${hit[2]}${hit[3] ? `.${hit[3]}` : ""}`;
  hit = CLAUDE_OLD.exec(m);
  if (hit) return `${cap(hit[3]!)} ${hit[1]}${hit[2] ? `.${hit[2]}` : ""}`;
  return raw;
}
