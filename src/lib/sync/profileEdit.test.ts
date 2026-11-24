import { describe, expect, it } from "vitest";
import {
  builtInJson,
  customModels,
  draftFromProfile,
  duplicateProfile,
  forgetCustomModel,
  inferAgents,
  isSecretName,
  parseExports,
  profileJson,
  rememberCustomModel,
  removeProfile,
  storedProfile,
  suggestName,
  upsertProfile,
  validateDraft,
} from "./profileEdit";
import { BUILT_IN_PROFILES, decodeAccountSettings, decodeProfile } from "./profiles";

const stored = {
  id: "custom_1",
  name: "Gateway",
  description: null,
  anthropicConfig: { baseUrl: "https://gw.example/anthropic", authToken: null, model: null },
  startupBashScript: "export X=1",
  environmentVariables: [{ name: "ANTHROPIC_AUTH_TOKEN", value: "${GW_KEY:-}" }],
  models: ["glm-5@200000"],
  compatibility: { claude: true, codex: false, agy: false, pi: true },
  codexProviders: [],
  isBuiltIn: false,
  createdAt: 100,
  updatedAt: 100,
  version: "1.0.0",
  futureField: { kept: true },
};
const settings = { themeMode: "dark", unknownTopLevel: [1, 2], profiles: [stored], lastUsedProfilesByAgent: { claude: "custom_1", codex: "openai" }, lastUsedProfile: "custom_1" };

describe("profileJson", () => {
  it("round-trips a stored profile, keeping fields the editor does not show", () => {
    const p = decodeProfile(stored)!;
    const d = draftFromProfile(p);
    expect(d.models).toEqual([{ model: "glm-5", window: 200000 }]);
    d.name = " Renamed ";
    d.env.push({ name: "ANTHROPIC_MODEL", value: "${GW_MODEL:-glm-5}" }, { name: " ", value: "dropped" });
    const out = profileJson(d, stored, stored.id, 200);
    expect(out).toMatchObject({
      id: "custom_1",
      name: "Renamed",
      anthropicConfig: stored.anthropicConfig,
      startupBashScript: "export X=1",
      futureField: { kept: true },
      models: ["glm-5@200000"],
      createdAt: 100,
      updatedAt: 200,
      // The default is the reference's fallback, never the `${…}` itself.
      defaultModelMode: "glm-5",
    });
    expect(out.environmentVariables).toHaveLength(2);
    // Decodes again as the same profile.
    expect(decodeProfile(out)?.name).toBe("Renamed");
  });

  it("writes every field Flutter's fromJson needs for a new profile", () => {
    const d = draftFromProfile(undefined);
    d.name = "New";
    const out = profileJson(d, undefined, "custom_9", 9);
    expect(out).toMatchObject({ id: "custom_9", name: "New", description: null, environmentVariables: [], models: [], codexProviders: [], isBuiltIn: false, createdAt: 9, updatedAt: 9, version: "1.0.0" });
    expect(out.compatibility).toEqual({ claude: true, codex: true, agy: true, pi: true });
  });

  it("customising a built-in keeps its id and built-in flag", () => {
    const zai = BUILT_IN_PROFILES.find((p) => p.id === "zai")!;
    const out = profileJson(draftFromProfile(zai), builtInJson(zai), zai.id, 5);
    expect(out).toMatchObject({ id: "zai", isBuiltIn: true, defaultModelMode: "glm-5.1" });
  });
});

describe("validateDraft", () => {
  it("requires a name, an agent and well-formed Codex providers", () => {
    const d = draftFromProfile(undefined);
    d.claude = d.codex = d.agy = false;
    expect(Object.keys(validateDraft(d))).toEqual(["name", "agents"]);
    d.name = "x";
    d.codex = true;
    d.codexProviders = [{ id: "bad id", baseUrl: "", envKey: "lower", wireApi: "chat" }];
    expect(Object.keys(validateDraft(d)).sort()).toEqual(["codex.0.baseUrl", "codex.0.envKey", "codex.0.id"]);
  });
});

describe("settings edits", () => {
  it("upserts in place, keeps unknown top-level keys", () => {
    const next = upsertProfile(settings, { ...stored, name: "B" });
    expect(next.unknownTopLevel).toEqual([1, 2]);
    expect((next.profiles as unknown[]).length).toBe(1);
    expect(storedProfile(next, "custom_1")?.name).toBe("B");
    expect((upsertProfile(settings, { id: "x" }).profiles as unknown[]).length).toBe(2);
  });

  it("removing forgets the profile as a last choice", () => {
    const next = removeProfile(settings, "custom_1");
    expect(next.profiles).toEqual([]);
    expect(next.lastUsedProfilesByAgent).toEqual({ codex: "openai" });
    expect(next.lastUsedProfile).toBeNull();
  });

  it("duplicates under a new id", () => {
    const next = duplicateProfile(settings, stored, 7);
    expect(storedProfile(next, "custom_7")).toMatchObject({ name: "Gateway (copy)", isBuiltIn: false, futureField: { kept: true } });
  });

  it("remembers custom models newest first, once", () => {
    let s: Record<string, unknown> = { customModelModes: ["a"] };
    s = rememberCustomModel(s, " b ");
    s = rememberCustomModel(s, "a");
    expect(customModels(s)).toEqual(["b", "a"]);
    expect(customModels(forgetCustomModel(s, "a"))).toEqual(["b"]);
    expect(decodeAccountSettings(s).customModelModes).toEqual(["b", "a"]);
  });
});

describe("import", () => {
  it("parses export lines like Flutter", () => {
    const env = parseExports(`# comment\nexport ANTHROPIC_BASE_URL="https://x.ai/anthropic"\nANTHROPIC_AUTH_TOKEN='sk-1'\nnot a var\nexport ANTHROPIC_MODEL=vendor/glm-5`);
    expect(env).toEqual([
      { name: "ANTHROPIC_BASE_URL", value: "https://x.ai/anthropic" },
      { name: "ANTHROPIC_AUTH_TOKEN", value: "sk-1" },
      { name: "ANTHROPIC_MODEL", value: "vendor/glm-5" },
    ]);
    expect(inferAgents(env)).toEqual({ claude: true, codex: false, agy: false, pi: true });
    expect(suggestName(env)).toBe("glm-5");
    // Never names a profile after a credential.
    expect(suggestName([{ name: "OPENAI_API_KEY", value: "sk-x" }])).toBeUndefined();
  });

  it("masks credentials only", () => {
    for (const n of ["ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "DB_PASSWORD", "GITHUB_TOKEN", "APIKEY"]) expect(isSecretName(n), n).toBe(true);
    for (const n of ["ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL", "API_TIMEOUT_MS", "MAX_TOKEN_COUNT", "KEYSTONE_URL"]) expect(isSecretName(n), n).toBe(false);
  });
});
