// Editing provider profiles and custom model picks in the account settings
// blob. Pure: every edit is a function of the decrypted settings JSON, so
// Account.updateAccountSettings can re-run it on a fresh copy after a version
// conflict.
//
// The blob belongs to happy_flutter (`Settings.toJson`): unknown top-level
// keys and unknown profile fields are kept verbatim, and every profile written
// here decodes with Flutter's AIBackendProfile.fromJson (one malformed profile
// would fail Flutter's whole settings decode). Sources: happy_flutter
// features/settings/profile_editor_screen.dart, profiles_screen.dart,
// core/utils/shell_script_parser.dart, env_secrets.dart,
// features/chat/widgets/picker_sheets.dart (`customModelModes`).
import { BUILT_IN_PROFILES, expandDefault, type CodexProvider, type EnvVar, type ProviderProfile } from "./profiles";

export type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export interface ModelEntry {
  model: string;
  /** Tokens pinned for this model (`id@tokens`); undefined = its own default. */
  window?: number | undefined;
}

/** What the editor edits. Everything else on the stored profile is kept. */
export interface ProfileDraft {
  name: string;
  description: string;
  claude: boolean;
  codex: boolean;
  agy: boolean;
  /** Not shown in the editor (Flutter neither); carried along. */
  pi: boolean;
  env: EnvVar[];
  models: ModelEntry[];
  contextWindow?: number | undefined;
  codexProviders: CodexProvider[];
  codexModelProvider: string;
}

/** Flutter's selectableContextWindows (1M also requests Claude's `[1m]`). */
export const CONTEXT_WINDOWS = [32_000, 128_000, 200_000, 256_000, 500_000, 1_000_000] as const;

export function windowLabel(tokens: number): string {
  if (tokens === 1_000_000) return "1M tokens";
  return tokens % 1000 === 0 ? `${tokens / 1000}k` : String(tokens);
}

function parseModelEntry(raw: string): ModelEntry {
  const t = raw.trim();
  const at = t.lastIndexOf("@");
  if (at <= 0 || at === t.length - 1) return { model: t };
  const n = Number(t.slice(at + 1));
  return Number.isInteger(n) && n > 0 ? { model: t.slice(0, at), window: n } : { model: t };
}

export function draftFromProfile(p: ProviderProfile | undefined): ProfileDraft {
  return {
    name: p?.name ?? "",
    description: p?.description ?? "",
    claude: p?.compatibility.claude ?? true,
    codex: p?.compatibility.codex ?? true,
    agy: p?.compatibility.agy ?? true,
    pi: p?.compatibility.pi ?? true,
    env: p?.env.map((e) => ({ ...e })) ?? [],
    models: p?.models.map(parseModelEntry) ?? [],
    contextWindow: p?.contextWindow,
    codexProviders: p?.codexProviders.map((c) => ({ ...c })) ?? [],
    codexModelProvider: p?.codexModelProvider ?? "",
  };
}

/** A new profile from a built-in: its routing env and agents, new id. */
export function draftFromTemplate(p: ProviderProfile): ProfileDraft {
  return { ...draftFromProfile(p), models: [], contextWindow: undefined };
}

const CODEX_ID = /^[A-Za-z0-9_-]+$/;
const ENV_KEY = /^[A-Z_][A-Z0-9_]*$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Field errors, keyed by field (`name`, `agents`, `env.3`, `codex.1.id`, …). */
export function validateDraft(d: ProfileDraft): Record<string, string> {
  const out: Record<string, string> = {};
  if (!d.name.trim()) out.name = "Name is required";
  if (!d.claude && !d.codex && !d.agy) out.agents = "Pick at least one agent";
  d.env.forEach((e, i) => {
    const n = e.name.trim();
    if (n && !ENV_NAME.test(n)) out[`env.${i}`] = "Letters, digits and _ only";
  });
  if (d.codex) {
    d.codexProviders.forEach((c, i) => {
      if (!c.id.trim()) out[`codex.${i}.id`] = "Required";
      else if (!CODEX_ID.test(c.id.trim())) out[`codex.${i}.id`] = "Letters, digits, - and _ only";
      if (!c.baseUrl.trim()) out[`codex.${i}.baseUrl`] = "Required";
      if (!ENV_KEY.test(c.envKey.trim())) out[`codex.${i}.envKey`] = "An env var name, e.g. OPENAI_API_KEY";
    });
  }
  return out;
}

const nonDefault = (v: string | undefined) => {
  const t = v?.trim();
  return t && t !== "default" ? t : undefined;
};

/** Flutter's inferDefaultModelMode over what the editor saw, except that a
 * `${VAR:-model}` reference yields `model`, not the reference itself. */
function inferDefault(env: EnvVar[], models: ModelEntry[]): string | undefined {
  for (const n of ["OPENAI_MODEL", "AZURE_OPENAI_DEPLOYMENT_NAME", "ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL"]) {
    const e = env.find((x) => x.name === n);
    if (e) {
      const v = nonDefault(expandDefault(e.value));
      if (v) return v;
    }
  }
  return models.map((m) => nonDefault(m.model)).find(Boolean);
}

/** The stored JSON for `d`, on top of `base` (the stored profile, or a
 * built-in's JSON when customising one; undefined for a new profile). */
export function profileJson(d: ProfileDraft, base: Json | undefined, id: string, now: number): Json {
  const prev = base ?? {};
  const env = d.env.filter((e) => e.name.trim()).map((e) => ({ name: e.name.trim(), value: e.value }));
  const models = d.models.filter((m) => m.model.trim()).map((m) => ({ model: m.model.trim(), window: m.window }));
  const codexProviders = d.codexProviders
    .filter((c) => c.id.trim() && c.baseUrl.trim())
    .map((c) => ({ id: c.id.trim(), name: c.name?.trim() || null, baseUrl: c.baseUrl.trim(), envKey: c.envKey.trim(), wireApi: c.wireApi === "chat" ? "chat" : "responses" }));
  const prevCompat = isObj(prev.compatibility) ? prev.compatibility : {};
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    ...prev,
    id,
    name: d.name.trim(),
    description: d.description.trim() || null,
    environmentVariables: env,
    models: models.map((m) => (m.window ? `${m.model}@${m.window}` : m.model)),
    contextWindow: d.contextWindow ?? null,
    compatibility: { ...prevCompat, claude: d.claude, codex: d.codex, agy: d.agy, pi: d.pi },
    codexProviders,
    codexModelProvider: d.codexModelProvider.trim() || null,
    defaultModelMode: inferDefault(env, models) ?? str(prev.defaultModelMode) ?? null,
    isBuiltIn: prev.isBuiltIn === true,
    createdAt: num(prev.createdAt) ?? now,
    updatedAt: now,
    version: str(prev.version) ?? "1.0.0",
  };
}

/** A built-in in Flutter's stored shape (what "customise" starts from). */
export function builtInJson(p: ProviderProfile): Json {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    environmentVariables: p.env.map((e) => ({ ...e })),
    models: [],
    compatibility: { ...p.compatibility },
    codexProviders: [],
    defaultModelMode: p.defaultModelMode ?? null,
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    version: "1.0.0",
  };
}

export const isBuiltInId = (id: string) => BUILT_IN_PROFILES.some((p) => p.id === id);

/** Flutter ids: `custom_<ms>`. */
export const newProfileId = (now: number) => `custom_${now}`;

// ---- settings-level edits ------------------------------------------------------

function storedProfiles(s: Json): unknown[] {
  return Array.isArray(s.profiles) ? s.profiles : [];
}

/** The stored JSON of profile `id`, if any. */
export function storedProfile(s: Json, id: string): Json | undefined {
  return storedProfiles(s).find((p): p is Json => isObj(p) && p.id === id);
}

/** Replaces the stored profile with the same id, else appends. */
export function upsertProfile(s: Json, profile: Json): Json {
  const list = storedProfiles(s);
  const i = list.findIndex((p) => isObj(p) && p.id === profile.id);
  return { ...s, profiles: i < 0 ? [...list, profile] : list.map((p, j) => (j === i ? profile : p)) };
}

/** Drops the stored profile (a built-in falls back to its definition) and
 * forgets it as any agent's last choice (Flutter _confirmDeleteProfile). */
export function removeProfile(s: Json, id: string): Json {
  const out: Json = { ...s, profiles: storedProfiles(s).filter((p) => !(isObj(p) && p.id === id)) };
  if (isObj(s.lastUsedProfilesByAgent)) {
    out.lastUsedProfilesByAgent = Object.fromEntries(Object.entries(s.lastUsedProfilesByAgent).filter(([, v]) => v !== id));
  }
  if (s.lastUsedProfile === id) out.lastUsedProfile = null;
  return out;
}

/** A copy under a new id (Flutter _duplicateProfile). */
export function duplicateProfile(s: Json, source: Json, now: number): Json {
  const name = typeof source.name === "string" ? source.name : "Profile";
  return upsertProfile(s, { ...source, id: newProfileId(now), name: `${name} (copy)`, isBuiltIn: false, createdAt: now, updatedAt: now });
}

// ---- custom models -------------------------------------------------------------

/** Typed-in model ids, newest first (Flutter `customModelModes`). */
export function customModels(s: Json): string[] {
  return Array.isArray(s.customModelModes) ? s.customModelModes.filter((m): m is string => typeof m === "string" && m.trim() !== "") : [];
}

export function rememberCustomModel(s: Json, slug: string): Json {
  const m = slug.trim();
  const list = customModels(s);
  if (!m || list.includes(m)) return s;
  return { ...s, customModelModes: [m, ...list] };
}

export function forgetCustomModel(s: Json, slug: string): Json {
  return { ...s, customModelModes: customModels(s).filter((m) => m !== slug) };
}

// ---- import ----------------------------------------------------------------------

/** `export KEY=value` / `KEY=value` lines (Flutter parseShellScript). */
export function parseExports(text: string): EnvVar[] {
  const out: EnvVar[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = /^(?:export\s+)?(\w+)=(.*)$/.exec(t);
    if (!m) continue;
    let v = m[2]!.trim();
    if (v.length >= 2 && ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"')))) v = v.slice(1, -1);
    out.push({ name: m[1]!, value: v });
  }
  return out;
}

/** Flutter inferProfileCompatibility: Anthropic vars → Claude, OpenAI/Azure
 * vars → Codex; neither keeps every agent. */
export function inferAgents(env: EnvVar[]): Pick<ProfileDraft, "claude" | "codex" | "agy" | "pi"> {
  const a = env.some((e) => e.name.startsWith("ANTHROPIC_"));
  const o = env.some((e) => e.name.startsWith("OPENAI_") || e.name.startsWith("AZURE_OPENAI_"));
  if (!a && !o) return { claude: true, codex: true, agy: true, pi: true };
  return { claude: a, codex: o, agy: false, pi: a };
}

const SECRET_SEGMENTS = new Set(["SECRET", "PASSWORD", "PASSWD", "PASS", "CREDENTIAL", "CREDENTIALS", "COOKIE", "PRIVATE", "BEARER"]);

/** Whether a var holds a credential and is masked (Flutter isSecretEnvName,
 * simplified): `…_KEY`/`…_TOKEN` suffixes and secret-ish words, not
 * `MAX_TOKEN_COUNT` or `ANTHROPIC_BASE_URL`. */
export function isSecretName(name: string): boolean {
  const segs = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const last = segs[segs.length - 1] ?? "";
  if (segs.some((s) => SECRET_SEGMENTS.has(s))) return true;
  return /(KEY|TOKEN|APIKEY|ACCESSTOKEN)$/.test(last);
}

/** A profile name from imported vars, never a credential (Flutter
 * suggestProfileName). */
export function suggestName(env: EnvVar[]): string | undefined {
  const pick =
    env.find((e) => ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL", "OPENAI_MODEL"].includes(e.name) && e.value) ??
    env.find((e) => !isSecretName(e.name) && e.value);
  if (!pick) return undefined;
  const parts = pick.value.split("/");
  return parts[parts.length - 1] || undefined;
}
