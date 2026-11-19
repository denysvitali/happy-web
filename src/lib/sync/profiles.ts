// Provider profiles: which backend (Anthropic login, Z.AI, OpenRouter, a Codex
// gateway, ...) an agent talks to. Pure: decoding the account settings,
// built-ins, compatibility, and turning a profile + model into the
// `profileId` / `environmentVariables` / `model` of spawn-happy-session.
//
// Sources: happy_flutter lib/core/models/settings.dart (AIBackendProfile),
// built_in_profiles.dart, services/_sync_operations_session_profile.dart and
// _sync_operations_session_model_env.dart; happy-cli-go
// internal/daemon/spawn_provider_env.go and spawn_model.go (the daemon is the
// authority on what it accepts).
//
// Profiles live in the account settings blob (GET /v1/account/settings,
// legacy secretbox under the master secret). Env values may be literals or
// `${VAR:-default}` references that the daemon expands from its own
// environment, which is how built-ins keep API keys on the daemon. Flutter
// keeps `openaiConfig/azureOpenAIConfig/togetherAIConfig.apiKey` on the device
// that created the profile; those never reach this client.
import { z } from "zod/mini";

export interface EnvVar {
  name: string;
  value: string;
}

export interface Compatibility {
  claude: boolean;
  codex: boolean;
  agy: boolean;
  pi: boolean;
}

export interface CodexProvider {
  id: string;
  name?: string | undefined;
  baseUrl: string;
  envKey: string;
  wireApi: string;
}

export interface ProviderProfile {
  id: string;
  name: string;
  description?: string | undefined;
  builtIn: boolean;
  env: EnvVar[];
  anthropic?: { baseUrl?: string | undefined; authToken?: string | undefined; model?: string | undefined } | undefined;
  openai?: { baseUrl?: string | undefined; model?: string | undefined; apiKey?: string | undefined } | undefined;
  azure?: { endpoint?: string | undefined; apiVersion?: string | undefined; deploymentName?: string | undefined; apiKey?: string | undefined } | undefined;
  together?: { model?: string | undefined; apiKey?: string | undefined } | undefined;
  tmux?: { sessionName?: string | undefined; tmpDir?: string | undefined; updateEnvironment?: boolean | undefined } | undefined;
  codexProviders: CodexProvider[];
  codexModelProvider?: string | undefined;
  defaultModelMode?: string | undefined;
  defaultPermissionMode?: string | undefined;
  contextWindow?: number | undefined;
  /** Model ids offered with this profile; `id@tokens` pins a context window. */
  models: string[];
  compatibility: Compatibility;
}

export interface AccountSettings {
  profiles: ProviderProfile[];
  /** Agent key → profile id, the new-session choice per agent. */
  lastUsedProfilesByAgent: Record<string, string>;
  /** Profile id (or `anthropic`/`openai` for no profile) → favourite model. */
  favoriteModelsByProfile: Record<string, string>;
  codexFastMode: boolean;
}

export const EMPTY_SETTINGS: AccountSettings = { profiles: [], lastUsedProfilesByAgent: {}, favoriteModelsByProfile: {}, codexFastMode: false };

/** Wire marker for "no profile": the agent's own account login. */
export const NO_PROFILE = "default";

// ---- decoding --------------------------------------------------------------

const optStr = z.catch(z.optional(z.string()), undefined);
const optBool = z.catch(z.optional(z.boolean()), undefined);
const optObj = <T extends z.ZodMiniObject>(o: T) => z.catch(z.optional(z.nullable(o)), undefined);

const envVar = z.object({ name: z.string(), value: z.catch(z.string(), "") });
const codexProvider = z.object({
  id: z.string(),
  name: z.catch(z.optional(z.nullable(z.string())), undefined),
  baseUrl: z.string(),
  envKey: z.catch(z.string(), "OPENAI_API_KEY"),
  wireApi: z.catch(z.string(), "responses"),
});
const compatibility = z.object({
  claude: z.catch(z.boolean(), true),
  codex: z.catch(z.boolean(), true),
  agy: z.catch(z.optional(z.boolean()), undefined),
  gemini: z.catch(z.optional(z.boolean()), undefined),
  pi: z.catch(z.boolean(), true),
});

const rawProfile = z.object({
  id: z.string().check(z.minLength(1)),
  name: z.catch(z.string(), ""),
  description: z.catch(z.optional(z.nullable(z.string())), undefined),
  isBuiltIn: optBool,
  environmentVariables: z.catch(z.array(z.unknown()), []),
  anthropicConfig: optObj(z.object({ baseUrl: optStr, authToken: optStr, model: optStr })),
  openaiConfig: optObj(z.object({ baseUrl: optStr, model: optStr, apiKey: optStr })),
  azureOpenAIConfig: optObj(z.object({ endpoint: optStr, apiVersion: optStr, deploymentName: optStr, apiKey: optStr })),
  togetherAIConfig: optObj(z.object({ model: optStr, apiKey: optStr })),
  tmuxConfig: optObj(z.object({ sessionName: optStr, tmpDir: optStr, updateEnvironment: optBool })),
  codexProviders: z.catch(z.array(z.unknown()), []),
  codexModelProvider: optStr,
  defaultModelMode: optStr,
  defaultPermissionMode: optStr,
  contextWindow: z.catch(z.optional(z.nullable(z.number())), undefined),
  models: z.catch(z.array(z.unknown()), []),
  compatibility: z.catch(z.optional(compatibility), undefined),
});

const strRecord = z.catch(z.record(z.string(), z.unknown()), {});

const rawSettings = z.object({
  profiles: z.catch(z.array(z.unknown()), []),
  lastUsedProfilesByAgent: strRecord,
  favoriteModelsByProfile: strRecord,
  codexFastMode: z.catch(z.boolean(), false),
});

const nonNull = <T>(v: T | null | undefined): T | undefined => v ?? undefined;
const stringsOf = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter((e): e is [string, string] => typeof e[1] === "string"));

/** One stored profile, or null when it is unusable (no id). */
export function decodeProfile(raw: unknown): ProviderProfile | null {
  const r = rawProfile.safeParse(raw);
  if (!r.success) return null;
  const p = r.data;
  const c = p.compatibility;
  return {
    id: p.id,
    name: p.name || p.id,
    description: nonNull(p.description),
    builtIn: p.isBuiltIn === true,
    env: p.environmentVariables.flatMap((e) => {
      const v = envVar.safeParse(e);
      return v.success && v.data.name ? [v.data] : [];
    }),
    anthropic: nonNull(p.anthropicConfig),
    openai: nonNull(p.openaiConfig),
    azure: nonNull(p.azureOpenAIConfig),
    together: nonNull(p.togetherAIConfig),
    tmux: nonNull(p.tmuxConfig),
    codexProviders: p.codexProviders.flatMap((x) => {
      const v = codexProvider.safeParse(x);
      return v.success ? [{ ...v.data, name: nonNull(v.data.name) }] : [];
    }),
    codexModelProvider: p.codexModelProvider,
    defaultModelMode: p.defaultModelMode,
    defaultPermissionMode: p.defaultPermissionMode,
    contextWindow: nonNull(p.contextWindow),
    models: p.models.filter((m): m is string => typeof m === "string" && m.trim() !== ""),
    // Flutter's default is claude/codex/agy on; profiles from the retired
    // Gemini agent carry `gemini` instead of `agy`.
    compatibility: c ? { claude: c.claude, codex: c.codex, agy: c.agy ?? c.gemini ?? true, pi: c.pi } : { claude: true, codex: true, agy: true, pi: true },
  };
}

/** The decrypted account settings blob (Flutter's `Settings.toJson`). */
export function decodeAccountSettings(raw: unknown): AccountSettings {
  const r = rawSettings.safeParse(raw ?? {});
  if (!r.success) return EMPTY_SETTINGS;
  const byAgent = stringsOf(r.data.lastUsedProfilesByAgent);
  // Flutter migrates the retired `gemini` key to `agy`.
  if (byAgent.gemini !== undefined) {
    byAgent.agy ??= byAgent.gemini;
    delete byAgent.gemini;
  }
  return {
    profiles: r.data.profiles.map(decodeProfile).filter((p): p is ProviderProfile => p !== null),
    lastUsedProfilesByAgent: byAgent,
    favoriteModelsByProfile: stringsOf(r.data.favoriteModelsByProfile),
    codexFastMode: r.data.codexFastMode,
  };
}

// ---- built-ins (mirrors happy_flutter built_in_profiles.dart) ----------------

const CLAUDE_ONLY: Compatibility = { claude: true, codex: false, agy: false, pi: true };
const CODEX_ONLY: Compatibility = { claude: false, codex: true, agy: false, pi: false };
const env = (pairs: [string, string][]): EnvVar[] => pairs.map(([name, value]) => ({ name, value }));
const builtIn = (p: Pick<ProviderProfile, "id" | "name" | "description" | "defaultModelMode" | "compatibility"> & { env?: EnvVar[] }): ProviderProfile => ({
  builtIn: true,
  codexProviders: [],
  models: [],
  ...p,
  env: p.env ?? [],
});

/** Anthropic-compatible gateway env in Flutter's shape for `prefix`. */
function gatewayEnv(prefix: string, baseUrl: string, model: string, keyName = "API_KEY", timeout = "3000000"): EnvVar[] {
  return env([
    ["ANTHROPIC_BASE_URL", `\${${prefix}_BASE_URL:-${baseUrl}}`],
    ["ANTHROPIC_AUTH_TOKEN", `\${${prefix}_${keyName}:-}`],
    ["ANTHROPIC_MODEL", `\${${prefix}_MODEL:-${model}}`],
    ["ANTHROPIC_SMALL_FAST_MODEL", `\${${prefix}_SMALL_FAST_MODEL:-${model}}`],
    ["ANTHROPIC_DEFAULT_SONNET_MODEL", `\${${prefix}_SONNET_MODEL:-${model}}`],
    ["ANTHROPIC_DEFAULT_OPUS_MODEL", `\${${prefix}_OPUS_MODEL:-${model}}`],
    ["ANTHROPIC_DEFAULT_HAIKU_MODEL", `\${${prefix}_HAIKU_MODEL:-${model}}`],
    ["API_TIMEOUT_MS", `\${${prefix}_API_TIMEOUT_MS:-${timeout}}`],
    ["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", `\${${prefix}_CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:-1}`],
  ]);
}

export const BUILT_IN_PROFILES: readonly ProviderProfile[] = [
  builtIn({ id: "anthropic", name: "Anthropic (Default)", description: "Official Anthropic Claude API", defaultModelMode: "default", compatibility: CLAUDE_ONLY }),
  builtIn({
    id: "deepseek",
    name: "DeepSeek (Chat)",
    description: "DeepSeek API via Anthropic-compatible interface",
    defaultModelMode: "deepseek-chat",
    compatibility: CLAUDE_ONLY,
    env: env([
      ["ANTHROPIC_BASE_URL", "${DEEPSEEK_BASE_URL:-https://api.deepseek.com/anthropic}"],
      ["ANTHROPIC_AUTH_TOKEN", "${DEEPSEEK_AUTH_TOKEN:-}"],
      ["API_TIMEOUT_MS", "${DEEPSEEK_API_TIMEOUT_MS:-600000}"],
      ["ANTHROPIC_MODEL", "${DEEPSEEK_MODEL:-deepseek-chat}"],
      ["ANTHROPIC_DEFAULT_HAIKU_MODEL", "${DEEPSEEK_HAIKU_MODEL:-deepseek-chat}"],
      ["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "${DEEPSEEK_CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:-1}"],
    ]),
  }),
  builtIn({
    id: "zai",
    name: "Z.AI (GLM-5.1)",
    description: "Z.AI GLM Coding Plan via Anthropic-compatible interface",
    defaultModelMode: "GLM-5.1",
    compatibility: CLAUDE_ONLY,
    env: env([
      ["ANTHROPIC_BASE_URL", "${Z_AI_BASE_URL:-https://api.z.ai/api/anthropic}"],
      ["ANTHROPIC_AUTH_TOKEN", "${Z_AI_AUTH_TOKEN:-}"],
      ["API_TIMEOUT_MS", "${Z_AI_API_TIMEOUT_MS:-3000000}"],
      ["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "${Z_AI_CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:-1}"],
      ["ANTHROPIC_DEFAULT_OPUS_MODEL", "${Z_AI_OPUS_MODEL:-glm-5.1}"],
      ["ANTHROPIC_DEFAULT_SONNET_MODEL", "${Z_AI_SONNET_MODEL:-glm-4.7}"],
      ["ANTHROPIC_DEFAULT_HAIKU_MODEL", "${Z_AI_HAIKU_MODEL:-glm-4.5-air}"],
    ]),
  }),
  builtIn({
    id: "minimax",
    name: "MiniMax (MiniMax-M2.7)",
    description: "MiniMax-M2.7 via Anthropic-compatible interface",
    defaultModelMode: "MiniMax-M2.7",
    compatibility: CLAUDE_ONLY,
    env: gatewayEnv("MINIMAX", "https://api.minimax.io/anthropic", "MiniMax-M2.7"),
  }),
  builtIn({
    id: "xiaomi-mimo",
    name: "Xiaomi MiMo (Token Plan)",
    description: "Xiaomi MiMo Token Plan via Anthropic-compatible interface",
    defaultModelMode: "mimo-v2.5-pro",
    compatibility: CLAUDE_ONLY,
    env: gatewayEnv("XIAOMI_MIMO", "https://token-plan-sgp.xiaomimimo.com/anthropic", "mimo-v2.5-pro"),
  }),
  builtIn({
    id: "qwen",
    name: "Qwen (Token Plan)",
    description: "Qwen Cloud Token Plan via Anthropic-compatible interface",
    defaultModelMode: "qwen3.7-max",
    compatibility: CLAUDE_ONLY,
    env: gatewayEnv("QWEN", "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic", "qwen3.7-max"),
  }),
  builtIn({
    id: "openrouter",
    name: "OpenRouter",
    description: "OpenRouter — unified gateway to 200+ models",
    defaultModelMode: "anthropic/claude-opus-4.6",
    compatibility: CLAUDE_ONLY,
    env: env([
      ["ANTHROPIC_BASE_URL", "${OPENROUTER_BASE_URL:-https://openrouter.ai/api}"],
      ["ANTHROPIC_AUTH_TOKEN", "${OPENROUTER_API_KEY:-}"],
      ["ANTHROPIC_API_KEY", ""],
      ["ANTHROPIC_DEFAULT_OPUS_MODEL", "${OPENROUTER_OPUS_MODEL:-anthropic/claude-opus-4.6}"],
      ["ANTHROPIC_DEFAULT_SONNET_MODEL", "${OPENROUTER_SONNET_MODEL:-anthropic/claude-sonnet-4.6}"],
      ["ANTHROPIC_DEFAULT_HAIKU_MODEL", "${OPENROUTER_HAIKU_MODEL:-anthropic/claude-haiku-4.5}"],
      ["CLAUDE_CODE_SUBAGENT_MODEL", "${OPENROUTER_SUBAGENT_MODEL:-anthropic/claude-opus-4.6}"],
    ]),
  }),
  builtIn({
    id: "openai",
    name: "OpenAI (Codex)",
    description: "OpenAI Codex API",
    defaultModelMode: "default",
    compatibility: CODEX_ONLY,
    env: env([
      ["OPENAI_BASE_URL", "https://api.openai.com/v1"],
      ["OPENAI_MODEL", ""],
      ["OPENAI_API_TIMEOUT_MS", "600000"],
      ["OPENAI_SMALL_FAST_MODEL", ""],
      ["API_TIMEOUT_MS", "600000"],
      ["CODEX_SMALL_FAST_MODEL", ""],
    ]),
  }),
  builtIn({
    id: "azure-openai",
    name: "Azure OpenAI",
    description: "Azure OpenAI Service for enterprise deployments",
    defaultModelMode: "gpt-5-codex",
    compatibility: CODEX_ONLY,
    env: env([
      ["AZURE_OPENAI_API_VERSION", "2024-02-15-preview"],
      ["AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-5-codex"],
      ["OPENAI_API_TIMEOUT_MS", "600000"],
      ["API_TIMEOUT_MS", "600000"],
    ]),
  }),
  builtIn({
    id: "qwen-token-plan-codex",
    name: "Qwen (Token Plan, Codex)",
    description: "Qwen Cloud Token Plan via OpenAI-compatible interface (Codex)",
    defaultModelMode: "qwen3.7-max",
    compatibility: CODEX_ONLY,
    env: env([
      ["OPENAI_BASE_URL", "${QWEN_OPENAI_BASE_URL:-https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1}"],
      ["OPENAI_API_KEY", "${QWEN_API_KEY:-}"],
      ["OPENAI_MODEL", "${QWEN_MODEL:-qwen3.7-max}"],
      ["OPENAI_SMALL_FAST_MODEL", "${QWEN_SMALL_FAST_MODEL:-qwen3.7-max}"],
      ["OPENAI_API_TIMEOUT_MS", "${QWEN_API_TIMEOUT_MS:-3000000}"],
      ["API_TIMEOUT_MS", "${QWEN_API_TIMEOUT_MS:-3000000}"],
    ]),
  }),
  builtIn({
    id: "custom-codex-proxy",
    name: "Custom Codex Proxy",
    description: "Any OpenAI-compatible gateway for Codex (base URL required)",
    defaultModelMode: "default",
    compatibility: CODEX_ONLY,
    env: env([
      ["OPENAI_BASE_URL", "${CUSTOM_CODEX_BASE_URL:-}"],
      ["OPENAI_API_KEY", "${CUSTOM_CODEX_API_KEY:-}"],
      ["OPENAI_MODEL", "${CUSTOM_CODEX_MODEL:-}"],
      ["HAPPY_CODEX_PROVIDER_ENV_KEY", "${CUSTOM_CODEX_ENV_KEY:-OPENAI_API_KEY}"],
      ["HAPPY_CODEX_PROVIDER_WIRE_API", "${CUSTOM_CODEX_WIRE_API:-chat}"],
      ["HAPPY_CODEX_PROVIDER_NAME", "${CUSTOM_CODEX_PROVIDER_NAME:-}"],
      ["API_TIMEOUT_MS", "${CUSTOM_CODEX_API_TIMEOUT_MS:-600000}"],
    ]),
  }),
];

/** Qwen Token Plan slugs Codex accepts beyond `gpt-*` / `o*`. */
const TOKEN_PLAN_CODEX_MODELS = new Set(["qwen3.8-max-preview", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-flash", "glm-5.2", "deepseek-v4-pro"]);

// ---- agents ----------------------------------------------------------------

/** Flutter's normalizeAgentKey: the key of `lastUsedProfilesByAgent`. */
export function agentKey(agent: string | undefined): string {
  switch (agent) {
    case "codex":
    case "har":
    case "prime-agent":
    case "pi":
    case "opencode":
      return agent;
    case "agy":
    case "gemini":
      return "agy";
    case "grok":
    case "grok-build":
      return "grok";
    default:
      return "claude";
  }
}

/** Only Claude and Codex take provider profiles: the daemon drops them for
 * OpenCode, Har's provider is fixed per conversation and Prime Agent picks
 * models over ACP. */
export function agentUsesProfiles(agent: string | undefined): boolean {
  const k = agentKey(agent);
  return k === "claude" || k === "codex";
}

export function supportsAgent(p: ProviderProfile, agent: string | undefined): boolean {
  const k = agentKey(agent);
  if (k === "claude" || k === "codex" || k === "agy" || k === "pi") return p.compatibility[k];
  return true;
}

/** The user's profiles first, then built-ins they did not override, filtered
 * to `agent` (Flutter's in-session list). */
export function profilesForAgent(custom: readonly ProviderProfile[], agent: string | undefined): ProviderProfile[] {
  const seen = new Set<string>();
  return [...custom, ...BUILT_IN_PROFILES].filter((p) => supportsAgent(p, agent) && !seen.has(p.id) && (seen.add(p.id), true));
}

export function findProfile(custom: readonly ProviderProfile[], id: string | undefined): ProviderProfile | undefined {
  if (!id || id === NO_PROFILE) return undefined;
  return custom.find((p) => p.id === id) ?? BUILT_IN_PROFILES.find((p) => p.id === id);
}

/** Flutter's resolveSelectedProfileIdForAgent: the remembered profile when it
 * still exists and supports the agent; no entry means "no profile". */
export function selectedProfileIdForAgent(s: AccountSettings, agent: string | undefined, remembered?: string): string | undefined {
  const id = remembered ?? s.lastUsedProfilesByAgent[agentKey(agent)];
  if (!id || id === NO_PROFILE) return undefined;
  const p = findProfile(s.profiles, id);
  return p && supportsAgent(p, agent) ? id : undefined;
}

/** `clientProfileId` the daemon recorded: a profile id, NO_PROFILE for an
 * explicit "none", or undefined when no app chose this session's provider. */
export function sessionProfileId(meta: { clientProfileId?: string | undefined }): string | undefined {
  const id = meta.clientProfileId?.trim();
  return id ? id : undefined;
}

export const DEFAULT_PROVIDER_LABEL = "Default";

/** The label for a recorded profile id; undefined when no app chose it. */
export function providerLabel(id: string | undefined, profiles: readonly ProviderProfile[]): string | undefined {
  if (!id) return undefined;
  if (id === NO_PROFILE) return DEFAULT_PROVIDER_LABEL;
  return findProfile(profiles, id)?.name ?? id;
}

// ---- env helpers -----------------------------------------------------------

const REF = /^\$\{([^:}]+):-(.*)\}$/;

/** `${VAR:-x}` → `x`; anything else unchanged. */
export function expandDefault(value: string): string {
  return value.trim().replace(REF, "$2");
}

function envValue(p: ProviderProfile, name: string): string | undefined {
  return p.env.find((e) => e.name === name)?.value;
}

const nonDefault = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t && t !== "default" ? t : undefined;
};

function isOfficialUrl(raw: string, host: string): boolean {
  try {
    const u = new URL(raw.trim());
    const path = u.pathname.replace(/\/$/, "");
    return u.protocol === "https:" && u.hostname.toLowerCase() === host && (path === "" || path === "/v1");
  } catch {
    return false;
  }
}

export function anthropicBaseUrl(p: ProviderProfile): string | undefined {
  const raw = p.anthropic?.baseUrl || envValue(p, "ANTHROPIC_BASE_URL");
  return raw ? expandDefault(raw) || undefined : undefined;
}

export function isThirdPartyAnthropic(url: string | undefined): boolean {
  return !!url?.trim() && !isOfficialUrl(url, "api.anthropic.com");
}

function openaiBaseUrl(p: ProviderProfile): string | undefined {
  const raw = p.openai?.baseUrl || envValue(p, "OPENAI_BASE_URL");
  return raw ? expandDefault(raw) || undefined : undefined;
}

/** Codex profiles that route to their own catalog (Flutter _isCustomCodexProfile). */
export function isCustomCodexProfile(p: ProviderProfile | undefined): boolean {
  if (!p) return false;
  if (p.codexProviders.length || p.models.length || p.azure) return true;
  if (nonDefault(envValue(p, "AZURE_OPENAI_ENDPOINT")) || nonDefault(envValue(p, "AZURE_OPENAI_DEPLOYMENT_NAME"))) return true;
  const base = p.openai?.baseUrl ?? nonDefault(envValue(p, "OPENAI_BASE_URL"));
  return !!base && !isOfficialUrl(expandDefault(base), "api.openai.com");
}

/** Where the profile sends traffic, for display: a host, or undefined for the
 * agent's own account login. */
export function profileEndpoint(p: ProviderProfile | undefined): string | undefined {
  if (!p) return undefined;
  const raw = anthropicBaseUrl(p) ?? openaiBaseUrl(p) ?? (p.azure?.endpoint ? expandDefault(p.azure.endpoint) : undefined);
  if (!raw) return p.azure || envValue(p, "AZURE_OPENAI_DEPLOYMENT_NAME") ? "Azure OpenAI" : undefined;
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
}

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL|COOKIE|HEADER/i;

/** A display-safe rendering of an env var. Secret-looking names never show a
 * literal value; `${VAR:-}` references say the daemon supplies them. */
export function displayEnvValue(e: EnvVar): string {
  const m = e.value.trim().match(REF);
  if (m) {
    if (SECRET_NAME.test(e.name) || SECRET_NAME.test(m[1]!)) return `$${m[1]} on the daemon`;
    return m[2] ? m[2] : `$${m[1]} on the daemon`;
  }
  if (!e.value) return "(unset)";
  return SECRET_NAME.test(e.name) ? "••••••" : e.value;
}

/** Flutter keeps OpenAI/Azure/Together API keys on the phone that created the
 * profile; such a profile reaches the daemon here without its key. */
export function needsDeviceKey(p: ProviderProfile | undefined): boolean {
  if (!p) return false;
  const has = (name: string) => !!envValue(p, name)?.trim();
  return (!!p.openai && !p.openai.apiKey && !has("OPENAI_API_KEY")) || (!!p.azure && !p.azure.apiKey && !has("AZURE_OPENAI_API_KEY")) || (!!p.together && !p.together.apiKey && !has("TOGETHER_API_KEY"));
}

/** Flutter's _profileEnvironmentVariables: the profile's routing env. */
export function profileEnv(p: ProviderProfile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of p.env) out[e.name] = e.value;
  const set = (k: string, v: string | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set("ANTHROPIC_BASE_URL", p.anthropic?.baseUrl);
  set("ANTHROPIC_AUTH_TOKEN", p.anthropic?.authToken);
  set("ANTHROPIC_MODEL", p.anthropic?.model);
  set("OPENAI_API_KEY", p.openai?.apiKey);
  set("OPENAI_BASE_URL", p.openai?.baseUrl);
  set("OPENAI_MODEL", p.openai?.model);
  set("AZURE_OPENAI_API_KEY", p.azure?.apiKey);
  set("AZURE_OPENAI_ENDPOINT", p.azure?.endpoint);
  set("AZURE_OPENAI_API_VERSION", p.azure?.apiVersion);
  set("AZURE_OPENAI_DEPLOYMENT_NAME", p.azure?.deploymentName);
  set("TOGETHER_API_KEY", p.together?.apiKey);
  set("TOGETHER_MODEL", p.together?.model);
  set("TMUX_SESSION_NAME", p.tmux?.sessionName);
  set("TMUX_TMPDIR", p.tmux?.tmpDir);
  if (p.tmux?.updateEnvironment !== undefined) out.TMUX_UPDATE_ENVIRONMENT = String(p.tmux.updateEnvironment);
  if (p.codexProviders.length) {
    out.HAPPY_CODEX_PROVIDERS = JSON.stringify(p.codexProviders.map((c) => ({ id: c.id, name: c.name ?? null, baseUrl: c.baseUrl, envKey: c.envKey, wireApi: c.wireApi })));
    const selected = p.codexModelProvider?.trim();
    if (selected) out.HAPPY_CODEX_MODEL_PROVIDER = selected;
  }
  return out;
}

// ---- models ----------------------------------------------------------------

const CLAUDE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

/** Base model id: no `[1m]` marker, no terminal Claude effort. */
function providerModel(sel: string): string {
  let m = sel.trim();
  if (m.endsWith("[1m]")) m = m.slice(0, -4);
  const i = m.lastIndexOf(":");
  return i > 0 && CLAUDE_EFFORTS.has(m.slice(i + 1)) ? m.slice(0, i) : m;
}

function slugOf(sel: string): string {
  const i = sel.lastIndexOf(":");
  return i > 0 ? sel.slice(0, i) : sel;
}

/** Claude tier aliases and Claude ids: never valid on a third-party gateway. */
export function isClaudeModel(sel: string): boolean {
  const s = slugOf(sel.trim()).toLowerCase();
  return ["opus", "sonnet", "haiku", "fable"].includes(s) || s.startsWith("claude-") || s.includes("/claude-");
}

function isKnownCodexModel(sel: string): boolean {
  const s = sel.includes(":") ? sel.slice(0, sel.indexOf(":")) : sel;
  return s.startsWith("gpt-") || /^o\d/.test(s) || TOKEN_PLAN_CODEX_MODELS.has(s);
}

function parseModelEntry(raw: string): { model: string; window?: number } {
  const t = raw.trim();
  const at = t.lastIndexOf("@");
  if (at <= 0 || at === t.length - 1) return { model: t };
  const n = Number(t.slice(at + 1));
  return Number.isInteger(n) && n > 0 ? { model: t.slice(0, at), window: n } : { model: t };
}

/** Flutter's inferredDefaultModelMode. */
export function inferredDefaultModel(p: ProviderProfile): string | undefined {
  const fromEnv = (n: string) => {
    const v = envValue(p, n);
    return v === undefined ? undefined : nonDefault(v);
  };
  return (
    nonDefault(p.defaultModelMode) ??
    nonDefault(p.openai?.model) ??
    nonDefault(p.azure?.deploymentName) ??
    nonDefault(p.anthropic?.model) ??
    fromEnv("OPENAI_MODEL") ??
    fromEnv("AZURE_OPENAI_DEPLOYMENT_NAME") ??
    fromEnv("ANTHROPIC_MODEL") ??
    fromEnv("ANTHROPIC_DEFAULT_OPUS_MODEL") ??
    p.models.map((m) => nonDefault(parseModelEntry(m).model)).find(Boolean)
  );
}

/** Flutter's favoriteModelProviderKey. */
function favoriteKey(p: ProviderProfile | undefined, agent: string | undefined): string {
  if (p) return p.id;
  const k = agentKey(agent);
  return k === "claude" ? "anthropic" : k === "codex" ? "openai" : `agent:${k}`;
}

/** Drops a model the target provider cannot serve: Claude models on a
 * gateway, non-Claude ids on plain Claude, unknown Codex slugs on ChatGPT
 * (Flutter _normalizeModelModeForAgent; the daemon refuses the first with
 * `provider_model_mismatch`). */
export function normalizeModelForProfile(model: string, p: ProviderProfile | undefined, agent: string | undefined): string {
  const m = model.trim();
  if (!m || m === "default") return "default";
  const k = agentKey(agent);
  if (k === "claude") {
    const gateway = !!p && isThirdPartyAnthropic(anthropicBaseUrl(p));
    if (gateway) return isClaudeModel(m) ? "default" : m;
    const foreign = (m.includes("/") && !isClaudeModel(m)) || /^(gpt-|gemini-)/.test(slugOf(m));
    return foreign ? "default" : m;
  }
  if (k === "codex") {
    if (isClaudeModel(m)) return "default";
    if (!isCustomCodexProfile(p) && !isKnownCodexModel(m)) return "default";
  }
  return m;
}

/** The model a session (or a new one) should run after choosing `p`:
 * the current model when the profile lists it, else the favourite for that
 * provider, else the profile's default (Flutter _onProfileChanged). */
export function modelForProfile(o: { profile: ProviderProfile | undefined; agent: string | undefined; current?: string | undefined; favorites?: Record<string, string> | undefined }): string {
  const { profile: p, agent } = o;
  const current = o.current?.trim();
  if (p && current && p.models.some((e) => parseModelEntry(e).model === current)) return current;
  const fav = o.favorites?.[favoriteKey(p, agent)]?.trim();
  return normalizeModelForProfile(fav || (p ? inferredDefaultModel(p) : undefined) || "default", p, agent);
}

function contextWindowFor(p: ProviderProfile, model: string): number | undefined {
  const m = model.trim();
  if (m && m !== "default") {
    for (const e of p.models) {
      const c = parseModelEntry(e);
      if (c.model === m || c.model === providerModel(m)) return c.window;
    }
  }
  return p.contextWindow && p.contextWindow > 0 ? p.contextWindow : undefined;
}

/** Re-points every Claude model knob at `main` on a gateway (Flutter
 * applyModelSelectionToEnv); a distinct fast model the profile set is kept
 * for the haiku-class knobs. */
function bindClaudeModel(e: Record<string, string>, main: string): Record<string, string> {
  const previous = providerModel(e.ANTHROPIC_MODEL ?? e.ANTHROPIC_DEFAULT_OPUS_MODEL ?? "");
  let fast: string | undefined;
  for (const n of ["ANTHROPIC_SMALL_FAST_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL"]) {
    const v = e[n];
    if (v && providerModel(v) !== previous) {
      fast = v;
      break;
    }
  }
  const m = providerModel(main);
  const f = fast ? providerModel(fast) : m;
  return {
    ...e,
    ANTHROPIC_MODEL: m,
    ANTHROPIC_SMALL_FAST_MODEL: f,
    ANTHROPIC_DEFAULT_OPUS_MODEL: m,
    ANTHROPIC_DEFAULT_SONNET_MODEL: f,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: f,
    ANTHROPIC_DEFAULT_FABLE_MODEL: m,
    ANTHROPIC_DEFAULT_MODEL: m,
    CLAUDE_CODE_SUBAGENT_MODEL: m,
  };
}

export interface ProviderSpawn {
  /** `profile_id`: the profile, or NO_PROFILE for the account login. */
  profileId: string;
  /** The complete provider routing (empty = account login). */
  environmentVariables: Record<string, string>;
  model: string;
}

/** profile + model → the provider part of spawn-happy-session. Throws when
 * the pairing cannot work, before the daemon refuses it. */
export function providerSpawn(o: { profile: ProviderProfile | undefined; agent: string | undefined; model: string; previousModel?: string | undefined }): ProviderSpawn {
  const { profile: p, agent } = o;
  const k = agentKey(agent);
  const requested = o.model.trim() || "default";
  if (!p) return { profileId: NO_PROFILE, environmentVariables: {}, model: normalizeModelForProfile(requested, undefined, agent) };
  const gateway = k === "claude" && isThirdPartyAnthropic(anthropicBaseUrl(p));
  // A tier alias falls back to the profile default; an explicit Claude id is
  // a mistake worth saying (Flutter rejectExplicitClaudeModelOnGateway).
  const slug = slugOf(requested).toLowerCase();
  if (gateway && (slug.startsWith("claude-") || slug.includes("/claude-"))) {
    throw new Error(`${requested} cannot run on ${p.name}: the daemon refuses Claude models on third-party gateways`);
  }
  const model = normalizeModelForProfile(requested, p, agent);
  let e = profileEnv(p);
  // A Claude model baked into a gateway profile would be refused too.
  if (gateway && e.ANTHROPIC_MODEL && isClaudeModel(expandDefault(e.ANTHROPIC_MODEL))) delete e.ANTHROPIC_MODEL;
  if (k === "claude") {
    const w = contextWindowFor(p, model);
    if (w) e.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(w);
    if (gateway && model !== "default") e = bindClaudeModel(e, model);
  }
  if (k === "codex" && model !== "default" && isCustomCodexProfile(p)) {
    const raw = model.endsWith("[1m]") ? model.slice(0, -4) : model;
    const i = raw.lastIndexOf(":");
    const effort = i > 0 && i < raw.length - 1 ? raw.slice(i + 1) : undefined;
    e.OPENAI_MODEL = effort ? raw.slice(0, i) : raw;
    if (effort) e.CODEX_MODEL_REASONING_EFFORT = effort;
    else delete e.CODEX_MODEL_REASONING_EFFORT;
  }
  // With no model in the request or the env, the daemon checks the gateway
  // against the session's previous model and refuses a Claude one.
  if (gateway && model === "default" && !e.ANTHROPIC_MODEL && o.previousModel && isClaudeModel(o.previousModel)) {
    throw new Error(`${p.name} has no default model of its own, so the daemon would keep checking the previous Claude model against it. Start a new session on ${p.name} instead.`);
  }
  return { profileId: p.id, environmentVariables: e, model };
}

/** Models a Claude session on a third-party gateway can pick in place of the
 * Claude tiers it would refuse: the profile default plus its model list.
 * Undefined when the profile is not a gateway or names none. */
export function gatewayModels(p: ProviderProfile | undefined): string[] | undefined {
  if (!p || !isThirdPartyAnthropic(anthropicBaseUrl(p))) return undefined;
  const ids = [inferredDefaultModel(p), ...p.models.map((m) => parseModelEntry(m).model)].filter((m): m is string => !!m && !isClaudeModel(m));
  const out = [...new Set(ids)];
  return out.length ? out : undefined;
}
