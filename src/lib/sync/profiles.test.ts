import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PROFILES,
  decodeAccountSettings,
  displayEnvValue,
  findProfile,
  gatewayModels,
  inferredDefaultModel,
  modelForProfile,
  needsDeviceKey,
  normalizeModelForProfile,
  profileEndpoint,
  profileEnv,
  profilesForAgent,
  providerSpawn,
  selectedProfileIdForAgent,
  sessionProfileId,
  usesAccountLogin,
} from "./profiles";

// The shape happy_flutter's Settings.toJson writes (toJsonWithoutApiKeys).
const flutterSettings = {
  schemaVersion: 3,
  themeMode: "system",
  profiles: [
    {
      id: "p-glm",
      name: "My GLM",
      description: null,
      anthropicConfig: { baseUrl: "https://open.bigmodel.cn/api/anthropic", authToken: "sk-literal", model: null },
      openaiConfig: null,
      azureOpenAIConfig: null,
      togetherAIConfig: null,
      tmuxConfig: null,
      codexModelProvider: null,
      codexProviders: [],
      startupBashScript: null,
      environmentVariables: [{ name: "API_TIMEOUT_MS", value: "600000" }, { name: "" }, "junk"],
      defaultSessionType: null,
      defaultPermissionMode: "acceptEdits",
      defaultModelMode: null,
      contextWindow: 200000,
      models: ["glm-5@1000000", "glm-4.7", 3],
      compatibility: { claude: true, codex: false, gemini: false, pi: true },
      isBuiltIn: false,
      createdAt: 1,
      updatedAt: 2,
      version: "1.0.0",
    },
    { id: "zai", name: "Z.AI (mine)", environmentVariables: [{ name: "ANTHROPIC_BASE_URL", value: "https://api.z.ai/api/anthropic" }], compatibility: { claude: true, codex: false, agy: false, pi: false } },
    {
      id: "p-proxy",
      name: "LLM proxy",
      openaiConfig: { baseUrl: "https://proxy.example/v1", model: "kimi-k2" },
      codexProviders: [{ id: "proxy", baseUrl: "https://proxy.example/v1", envKey: "PROXY_KEY", wireApi: "chat" }],
      codexModelProvider: "proxy",
      compatibility: { claude: false, codex: true, agy: false, pi: false },
    },
    { name: "no id" },
    null,
  ],
  lastUsedProfilesByAgent: { claude: "p-glm", codex: "gone", gemini: "zai" },
  favoriteModelsByProfile: { anthropic: "opus", "p-glm": 5 },
  codexFastMode: true,
};

const settings = decodeAccountSettings(flutterSettings);

describe("decodeAccountSettings", () => {
  it("keeps usable profiles and drops malformed entries", () => {
    expect(settings.profiles.map((p) => p.id)).toEqual(["p-glm", "zai", "p-proxy"]);
    const glm = settings.profiles[0]!;
    expect(glm.env).toEqual([{ name: "API_TIMEOUT_MS", value: "600000" }]);
    expect(glm.models).toEqual(["glm-5@1000000", "glm-4.7"]);
    expect(glm.compatibility).toEqual({ claude: true, codex: false, agy: false, pi: true });
    expect(glm.description).toBeUndefined();
    expect(settings.lastUsedProfilesByAgent).toEqual({ claude: "p-glm", codex: "gone", agy: "zai" });
    expect(settings.favoriteModelsByProfile).toEqual({ anthropic: "opus" });
    expect(settings.codexFastMode).toBe(true);
  });

  it("survives an empty or hostile blob", () => {
    expect(decodeAccountSettings(null).profiles).toEqual([]);
    expect(decodeAccountSettings({ profiles: "x", lastUsedProfilesByAgent: [] })).toMatchObject({ profiles: [], lastUsedProfilesByAgent: {} });
  });
});

describe("profile lists", () => {
  it("puts user profiles first and lets them override built-ins", () => {
    const claude = profilesForAgent(settings.profiles, "claude");
    expect(claude[0]!.id).toBe("p-glm");
    expect(claude.filter((p) => p.id === "zai")).toHaveLength(1);
    expect(claude.find((p) => p.id === "zai")!.name).toBe("Z.AI (mine)");
    expect(claude.some((p) => p.id === "openai" || p.id === "p-proxy")).toBe(false);
    const codex = profilesForAgent(settings.profiles, "codex").map((p) => p.id);
    expect(codex).toEqual(["p-proxy", "openai", "azure-openai", "qwen-token-plan-codex", "custom-codex-proxy"]);
  });

  it("resolves the remembered choice only while it exists and fits the agent", () => {
    expect(selectedProfileIdForAgent(settings, "claude")).toBe("p-glm");
    expect(selectedProfileIdForAgent(settings, "codex")).toBeUndefined();
    expect(selectedProfileIdForAgent(settings, "claude", "openai")).toBeUndefined();
    expect(selectedProfileIdForAgent(settings, "claude", "default")).toBeUndefined();
    expect(selectedProfileIdForAgent(settings, "codex", "p-proxy")).toBe("p-proxy");
  });

  it("reads the daemon's record of the session's profile", () => {
    expect(sessionProfileId({ clientProfileId: " zai " })).toBe("zai");
    expect(sessionProfileId({ clientProfileId: "default" })).toBe("default");
    expect(sessionProfileId({})).toBeUndefined();
  });

  it("mirrors Flutter's eleven built-ins", () => {
    expect(BUILT_IN_PROFILES.map((p) => p.id)).toEqual(["anthropic", "deepseek", "zai", "minimax", "xiaomi-mimo", "qwen", "openrouter", "openai", "azure-openai", "qwen-token-plan-codex", "custom-codex-proxy"]);
  });
});

describe("env", () => {
  it("merges config blocks into the routing env", () => {
    const glm = findProfile(settings.profiles, "p-glm")!;
    expect(profileEnv(glm)).toEqual({ API_TIMEOUT_MS: "600000", ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic", ANTHROPIC_AUTH_TOKEN: "sk-literal" });
    const proxy = findProfile(settings.profiles, "p-proxy")!;
    expect(profileEnv(proxy)).toEqual({
      OPENAI_BASE_URL: "https://proxy.example/v1",
      OPENAI_MODEL: "kimi-k2",
      HAPPY_CODEX_PROVIDERS: '[{"id":"proxy","name":null,"baseUrl":"https://proxy.example/v1","envKey":"PROXY_KEY","wireApi":"chat"}]',
      HAPPY_CODEX_MODEL_PROVIDER: "proxy",
    });
  });

  it("never renders secrets", () => {
    expect(displayEnvValue({ name: "ANTHROPIC_AUTH_TOKEN", value: "sk-literal" })).toBe("••••••");
    expect(displayEnvValue({ name: "ANTHROPIC_AUTH_TOKEN", value: "${Z_AI_AUTH_TOKEN:-}" })).toBe("$Z_AI_AUTH_TOKEN on the daemon");
    expect(displayEnvValue({ name: "OPENAI_API_KEY", value: "${K:-sk-default}" })).toBe("$K on the daemon");
    expect(displayEnvValue({ name: "ANTHROPIC_BASE_URL", value: "${Z_AI_BASE_URL:-https://api.z.ai/api/anthropic}" })).toBe("https://api.z.ai/api/anthropic");
    expect(displayEnvValue({ name: "ANTHROPIC_API_KEY", value: "" })).toBe("(unset)");
  });

  it("describes the endpoint and device-held keys", () => {
    expect(profileEndpoint(findProfile([], "zai"))).toBe("api.z.ai");
    expect(profileEndpoint(findProfile([], "anthropic"))).toBeUndefined();
    expect(profileEndpoint(findProfile([], "azure-openai"))).toBe("Azure OpenAI");
    expect(needsDeviceKey(findProfile(settings.profiles, "p-proxy"))).toBe(true);
    expect(needsDeviceKey(findProfile([], "zai"))).toBe(false);
  });
});

describe("models", () => {
  const zai = findProfile([], "zai")!;
  const glm = findProfile(settings.profiles, "p-glm")!;

  it("infers a profile's default model like Flutter", () => {
    expect(inferredDefaultModel(zai)).toBe("GLM-5.1");
    expect(inferredDefaultModel(glm)).toBe("glm-5");
    expect(inferredDefaultModel(findProfile([], "anthropic")!)).toBeUndefined();
    expect(inferredDefaultModel(findProfile([], "deepseek")!)).toBe("deepseek-chat");
  });

  it("picks the model to run after a switch", () => {
    expect(modelForProfile({ profile: zai, agent: "claude", current: "opus" })).toBe("GLM-5.1");
    expect(modelForProfile({ profile: glm, agent: "claude", current: "glm-4.7" })).toBe("glm-4.7");
    expect(modelForProfile({ profile: undefined, agent: "claude", current: "GLM-5.1", favorites: { anthropic: "opus" } })).toBe("opus");
    expect(modelForProfile({ profile: undefined, agent: "claude", current: "GLM-5.1" })).toBe("default");
    // OpenRouter's own default is a Claude id, which the daemon refuses on a gateway.
    expect(modelForProfile({ profile: findProfile([], "openrouter"), agent: "claude" })).toBe("default");
  });

  it("drops models the provider cannot serve", () => {
    expect(normalizeModelForProfile("sonnet", zai, "claude")).toBe("default");
    expect(normalizeModelForProfile("glm-4.7", zai, "claude")).toBe("glm-4.7");
    expect(normalizeModelForProfile("gpt-5.5", undefined, "claude")).toBe("default");
    expect(normalizeModelForProfile("qwen3.7-max", undefined, "codex")).toBe("qwen3.7-max");
    expect(normalizeModelForProfile("kimi-k2", undefined, "codex")).toBe("default");
    expect(normalizeModelForProfile("kimi-k2", findProfile(settings.profiles, "p-proxy"), "codex")).toBe("kimi-k2");
  });

  it("binds the picked model and the profile's context window", () => {
    const r = providerSpawn({ profile: glm, agent: "claude", model: "glm-5" });
    expect(r.environmentVariables).toMatchObject({ ANTHROPIC_MODEL: "glm-5", CLAUDE_CODE_SUBAGENT_MODEL: "glm-5", CLAUDE_CODE_MAX_CONTEXT_TOKENS: "1000000" });
    expect(providerSpawn({ profile: glm, agent: "claude", model: "glm-4.7" }).environmentVariables.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
    expect(providerSpawn({ profile: glm, agent: "claude", model: "default" }).environmentVariables.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("200000");
    const codex = providerSpawn({ profile: findProfile(settings.profiles, "p-proxy"), agent: "codex", model: "kimi-k2:high" });
    expect(codex.environmentVariables).toMatchObject({ OPENAI_MODEL: "kimi-k2", CODEX_MODEL_REASONING_EFFORT: "high" });
  });

  it("refuses a gateway switch the daemon would reject on the old Claude model", () => {
    const openrouter = findProfile([], "openrouter");
    expect(() => providerSpawn({ profile: openrouter, agent: "claude", model: "default", previousModel: "opus" })).toThrow(/no default model/);
    expect(providerSpawn({ profile: openrouter, agent: "claude", model: "default" }).model).toBe("default");
    expect(providerSpawn({ profile: undefined, agent: "claude", model: "opus", previousModel: "GLM-5.1" })).toEqual({ profileId: "default", environmentVariables: {}, model: "opus" });
  });
});

describe("gatewayModels", () => {
  it("offers a gateway's own models instead of the Claude tiers", () => {
    expect(gatewayModels(findProfile([], "zai"))).toEqual(["GLM-5.1"]);
    expect(gatewayModels(findProfile(settings.profiles, "p-glm"))).toEqual(["glm-5", "glm-4.7"]);
    expect(gatewayModels(findProfile([], "anthropic"))).toBeUndefined();
    expect(gatewayModels(findProfile([], "openrouter"))).toBeUndefined();
  });
});

describe("usesAccountLogin", () => {
  const tmuxOnly = decodeAccountSettings({ profiles: [{ id: "p-tmux", name: "tmux", tmuxConfig: { sessionName: "x" } }] }).profiles;
  const keyRef = decodeAccountSettings({
    profiles: [{ id: "p-key", name: "key", environmentVariables: [{ name: "ANTHROPIC_API_KEY", value: "${MY_KEY:-}" }] }],
  }).profiles;
  it("is the plan login for no profile, the default built-ins, and cosmetic profiles", () => {
    expect(usesAccountLogin(undefined, [])).toBe(true);
    expect(usesAccountLogin("default", [])).toBe(true);
    expect(usesAccountLogin("anthropic", [])).toBe(true);
    expect(usesAccountLogin("p-tmux", tmuxOnly)).toBe(true);
  });
  it("is not for gateways, API keys, codex providers or unknown ids", () => {
    expect(usesAccountLogin("p-glm", settings.profiles)).toBe(false);
    expect(usesAccountLogin("zai", settings.profiles)).toBe(false);
    expect(usesAccountLogin("p-proxy", settings.profiles)).toBe(false);
    expect(usesAccountLogin("openai", [])).toBe(false);
    expect(usesAccountLogin("p-key", keyRef)).toBe(false);
    expect(usesAccountLogin("gone", settings.profiles)).toBe(false);
  });
});
