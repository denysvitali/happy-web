import { describe, expect, it } from "vitest";
import type { MachineItem, SessionItem } from "./account";
import type { MachineMetadata, SessionMetadata } from "./decode";
import {
  abbreviateHome,
  agentsFor,
  availableModes,
  backendRequestValue,
  buildProviderSwitchRequest,
  buildSpawnRequest,
  canSwitchProvider,
  cleanAdditionalRepos,
  clusterChoices,
  defaultClusterMachine,
  defaultLocalMachine,
  effectiveBranch,
  initialBackend,
  kubernetesCheckoutPath,
  mcpSelection,
  newSessionId,
  parseMissingBranchError,
  parseRepo,
  parseRepoBranchesReply,
  permissionModesFor,
  recentFolders,
  repoSuggestions,
  resolveHome,
  spawnBackends,
} from "./spawn";
import { findProfile, providerSpawn } from "./profiles";

const machine = (id: string, meta: MachineMetadata, activeAt = 0): MachineItem => ({ id, active: true, activeAt, meta, metadataVersion: 1 });
const session = (id: string, meta: SessionMetadata, updatedAt: number): SessionItem => ({
  id,
  active: false,
  activeAt: 0,
  archived: false,
  createdAt: 0,
  updatedAt,
  lifecycle: "",
  meta,
  metadataVersion: 1,
  agentState: {},
  agentStateVersion: 0,
  undecryptable: false,
});

describe("spawn helpers (Flutter parity)", () => {
  it("derives the Kubernetes checkout path from the repo URL", () => {
    expect(kubernetesCheckoutPath({}, "https://github.com/acme/My.Repo.git")).toBe("/workspace/my.repo");
    expect(kubernetesCheckoutPath({}, "git@github.com:acme/happy-web")).toBe("/workspace/happy-web");
    expect(kubernetesCheckoutPath({ kubernetesCheckoutBaseDir: "/src/" }, "https://x/y/Foo Bar/")).toBe("/src/foo-bar");
    expect(kubernetesCheckoutPath({}, "https://x/---")).toBe("/workspace/repository");
  });

  it("chooses backends like Flutter", () => {
    expect(spawnBackends({})).toEqual(["local"]);
    expect(initialBackend({ spawnBackends: ["kubernetes", "local"] })).toBe("local");
    expect(initialBackend({ spawnBackends: ["kubernetes"] })).toBe("kubernetes");
    expect(backendRequestValue({}, "kubernetes")).toBeUndefined();
    expect(backendRequestValue({ spawnBackends: ["local"] }, "kubernetes")).toBe("local");
    expect(backendRequestValue({ spawnBackends: ["local", "kubernetes"] }, "kubernetes")).toBe("kubernetes");
  });
});

describe("daemon choice", () => {
  const laptop = machine("m-laptop", { host: "laptop" }, 10);
  const k8sOld = machine("m-k8s-old", { host: "daemon", spawnBackends: ["kubernetes"] }, 5);
  const k8s = machine("m-k8s", { host: "daemon", spawnBackends: ["local", "kubernetes"] }, 20);
  const other = machine("m-other", { host: "other", spawnBackends: ["kubernetes"] }, 1);

  it("lists only modes some machine supports", () => {
    expect(availableModes([laptop])).toEqual(["local"]);
    expect(availableModes([k8sOld])).toEqual(["kubernetes"]);
    expect(availableModes([laptop, k8s])).toEqual(["local", "kubernetes"]);
    expect(availableModes([])).toEqual([]);
  });

  it("picks the freshest Kubernetes daemon, one per host", () => {
    expect(clusterChoices([laptop, k8sOld, other, k8s]).map((m) => m.id)).toEqual(["m-k8s", "m-other"]);
    expect(clusterChoices([k8sOld, k8s]).map((m) => m.id)).toEqual(["m-k8s"]);
  });

  it("defaults the computer to the remembered one, then the newest local session's", () => {
    const locals = [laptop, k8s];
    const sessions = [session("a", { machineId: "m-k8s", runtimeType: "kubernetes" }, 99), session("b", { machineId: "m-k8s" }, 50), session("c", { machineId: "m-laptop" }, 40)];
    expect(defaultLocalMachine(locals, sessions, "m-laptop")?.id).toBe("m-laptop");
    expect(defaultLocalMachine(locals, sessions, "gone")?.id).toBe("m-k8s");
    expect(defaultLocalMachine(locals, [sessions[0]!])?.id).toBe("m-k8s"); // freshest activeAt
    expect(defaultLocalMachine([laptop], [session("x", { machineId: "offline" }, 1)])?.id).toBe("m-laptop");
    expect(defaultLocalMachine([], [])).toBeUndefined();
  });
});

describe("default cluster", () => {
  // A dev daemon that advertises Kubernetes but cannot clone, with the freshest heartbeat.
  const dev = machine("m-dev", { host: "devbox", spawnBackends: ["local", "kubernetes"] }, 100);
  const prod = machine("m-prod", { host: "happy-daemon", spawnBackends: ["kubernetes"], defaultSpawnBackend: "kubernetes" }, 10);
  const clusters = [dev, prod];

  it("prefers the remembered pick, then the daemon running the newest Kubernetes session", () => {
    const sessions = [session("k", { machineId: "m-prod", runtimeType: "kubernetes" }, 5), session("l", { machineId: "m-dev" }, 9)];
    expect(defaultClusterMachine(clusters, sessions, "m-dev")?.id).toBe("m-dev");
    expect(defaultClusterMachine(clusters, sessions)?.id).toBe("m-prod");
    // A churned registration of the same daemon: matched by host.
    expect(defaultClusterMachine(clusters, [session("k", { machineId: "old-id", host: "happy-daemon", runtimeType: "kubernetes" }, 5)])?.id).toBe("m-prod");
  });

  it("then a daemon whose default is Kubernetes, never just the freshest heartbeat", () => {
    expect(defaultClusterMachine(clusters, [])?.id).toBe("m-prod");
    expect(defaultClusterMachine([dev], [])?.id).toBe("m-dev");
    expect(defaultClusterMachine([], [])).toBeUndefined();
  });
});

describe("local folders", () => {
  it("lists distinct non-Kubernetes folders of that machine, newest first", () => {
    const sessions = [
      session("1", { machineId: "m", path: "/home/me/a" }, 1),
      session("2", { machineId: "m", path: "/home/me/b/" }, 3),
      session("3", { machineId: "m", path: "/home/me/a" }, 5),
      session("4", { machineId: "m", path: "/workspace/x", runtimeType: "kubernetes" }, 9),
      session("5", { machineId: "other", path: "/elsewhere" }, 9),
      session("6", { machineId: "m" }, 9),
    ];
    expect(recentFolders(sessions, "m")).toEqual(["/home/me/a", "/home/me/b"]);
  });

  it("resolves and abbreviates ~", () => {
    expect(resolveHome("~/src", "/home/me/")).toBe("/home/me/src");
    expect(resolveHome(" ~ ", "/home/me")).toBe("/home/me");
    expect(resolveHome("~other/x", "/home/me")).toBe("~other/x");
    expect(resolveHome("~/src", undefined)).toBe("~/src");
    expect(abbreviateHome("/home/me/src", "/home/me")).toBe("~/src");
    expect(abbreviateHome("/home/meow", "/home/me")).toBe("/home/meow");
    expect(abbreviateHome("/home/me", "/home/me")).toBe("~");
  });
});

describe("repositories", () => {
  it("parses shorthand, URLs and scp-style remotes", () => {
    expect(parseRepo("acme/web")).toMatchObject({ host: "github.com", path: "acme/web", url: "https://github.com/acme/web", github: true, key: "github.com/acme/web" });
    expect(parseRepo("https://github.com/Acme/Web.git/")).toMatchObject({ path: "Acme/Web", url: "https://github.com/Acme/Web", key: "github.com/acme/web" });
    expect(parseRepo("github.com/acme/web")?.url).toBe("https://github.com/acme/web");
    expect(parseRepo("git@github.com:acme/web.git")).toMatchObject({ github: true, url: "https://github.com/acme/web" });
    expect(parseRepo("https://gitlab.com/group/sub/proj.git")).toMatchObject({ github: false, path: "group/sub/proj", url: "https://gitlab.com/group/sub/proj.git" });
  });

  it("rejects incomplete or non-repository input", () => {
    for (const bad of ["", "acme", "acme/", "github.com/acme", "https://github.com/acme/web/tree/main", "a b/c", "https://github.com/acme/web?x=1", "ftp://host/a/b", "acme/../x"]) {
      expect(parseRepo(bad), bad).toBeNull();
    }
  });

  it("cleans additional repos: dedupe, drop the primary, cap at 16", () => {
    const { repos, rejected } = cleanAdditionalRepos(["acme/web", "ACME/lib", "https://github.com/acme/lib.git", "nope", "git@github.com:acme/web.git", "https://gitlab.com/g/p"], "https://github.com/acme/Web");
    expect(repos).toEqual(["ACME/lib", "https://gitlab.com/g/p"]);
    expect(rejected).toEqual(["nope"]);
    expect(cleanAdditionalRepos(Array.from({ length: 20 }, (_, i) => `acme/r${i}`), "").repos).toHaveLength(16);
  });

  it("suggests distinct repos of Kubernetes sessions, newest first", () => {
    const sessions = [
      session("1", { runtimeType: "kubernetes", repoUrl: "https://github.com/acme/infra" }, 1),
      session("2", { runtimeType: "kubernetes", repoUrl: "https://github.com/acme/web" }, 5),
      session("3", { podName: "hs-x", repoUrl: "git@github.com:acme/infra.git" }, 3),
      session("4", { repoUrl: "https://github.com/acme/local" }, 9),
    ];
    expect(repoSuggestions(sessions)).toEqual(["acme/web", "acme/infra"]);
  });
});

describe("branches", () => {
  it("decodes repo-branches replies", () => {
    expect(parseRepoBranchesReply({ success: true, repo: "o/r", defaultBranch: "main", branches: ["main", "dev", 3], truncated: false, refExists: false })).toEqual({
      ok: true,
      repo: "o/r",
      defaultBranch: "main",
      branches: ["main", "dev"],
      truncated: false,
      refExists: false,
    });
    expect(parseRepoBranchesReply({ success: false, error: "no token", unavailable: true })).toEqual({ ok: false, error: "no token", unavailable: true, notFound: false });
    expect(parseRepoBranchesReply(null)).toMatchObject({ ok: false, unavailable: false });
  });

  it("prefers typed, then remembered, then the default branch", () => {
    expect(effectiveBranch({ typed: "x", remembered: "dev", defaultBranch: "main" })).toEqual({ branch: "x" });
    expect(effectiveBranch({ typed: "", remembered: "dev", defaultBranch: "main" })).toEqual({ branch: "" });
    expect(effectiveBranch({ typed: null, remembered: "dev", defaultBranch: "main" })).toEqual({ branch: "dev" });
    expect(effectiveBranch({ typed: null, remembered: "dev", defaultBranch: "main", rememberedExists: false })).toEqual({ branch: "main", substituted: "dev" });
    expect(effectiveBranch({ typed: null, defaultBranch: "main" })).toEqual({ branch: "main" });
    expect(effectiveBranch({ typed: null })).toEqual({ branch: "" });
  });

  it("recognises the daemon's missing-branch refusal", () => {
    expect(parseMissingBranchError('branch "main" does not exist in acme/web; its default branch is "master"')).toEqual({ ref: "main", repo: "acme/web", defaultBranch: "master" });
    expect(parseMissingBranchError('spawn failed: branch "feat/x" does not exist in acme/web')).toEqual({ ref: "feat/x", repo: "acme/web" });
    expect(parseMissingBranchError("clone failed")).toBeNull();
  });
});

describe("agents and MCP", () => {
  it("keeps Har off Kubernetes and picks permission modes per agent", () => {
    expect(agentsFor("local").map((a) => a.value)).toContain("har");
    expect(agentsFor("kubernetes").map((a) => a.value)).toEqual(["claude", "codex", "opencode"]);
    expect(permissionModesFor("codex")).toEqual(["default", "read-only", "safe-yolo", "yolo"]);
    expect(permissionModesFor("claude")).toEqual(["default", "acceptEdits", "plan", "bypassPermissions"]);
  });

  it("sends MCP servers only when the selection is not everything", () => {
    expect(mcpSelection(["prometheus", "loki", "github-actions"])).toBeUndefined();
    expect(mcpSelection(["loki", "bogus"])).toEqual(["loki"]);
    expect(mcpSelection([])).toEqual([]);
  });
});

describe("buildSpawnRequest", () => {
  it("creates client session ids", () => {
    expect(newSessionId()).toMatch(/^c[0-9a-f]{24}$/);
  });

  it("builds a local request", () => {
    expect(buildSpawnRequest({ machineId: "m", agent: "claude", backend: "local", directory: "/home/me/a", initialPrompt: "  hi  ", repoUrl: "acme/web", mcpServers: [] }, "c1")).toEqual({
      type: "spawn-in-directory",
      directory: "/home/me/a",
      sessionId: "c1",
      isRestore: false,
      agent: "claude",
      approvedNewDirectoryCreation: true,
      profileId: "default",
      environmentVariables: { HAPPY_INITIAL_PROMPT: "hi" },
      permissionMode: "default",
      model: "default",
      spawnBackend: "local",
      repoUrl: "",
      repoRef: "",
      repoCommit: "",
      additionalRepos: [],
      mcpServers: [],
      mcpServersSet: false,
    });
  });

  it("sends the chosen profile's routing env and default model", () => {
    const zai = findProfile([], "zai")!;
    const r = buildSpawnRequest({ machineId: "m", agent: "claude", directory: "/x", profile: zai, initialPrompt: "go" }, "c1");
    expect(r.profileId).toBe("zai");
    expect(r.model).toBe("default");
    expect(r.environmentVariables).toMatchObject({ ANTHROPIC_BASE_URL: "${Z_AI_BASE_URL:-https://api.z.ai/api/anthropic}", ANTHROPIC_AUTH_TOKEN: "${Z_AI_AUTH_TOKEN:-}", HAPPY_INITIAL_PROMPT: "go" });
    const picked = buildSpawnRequest({ machineId: "m", agent: "claude", directory: "/x", profile: zai, model: "GLM-5.1" }, "c1");
    expect(picked.model).toBe("GLM-5.1");
    expect(picked.environmentVariables).toMatchObject({ ANTHROPIC_MODEL: "GLM-5.1", ANTHROPIC_DEFAULT_OPUS_MODEL: "GLM-5.1", ANTHROPIC_DEFAULT_HAIKU_MODEL: "${Z_AI_HAIKU_MODEL:-glm-4.5-air}" });
  });

  it("refuses Claude ids on a gateway and drops tier aliases", () => {
    const zai = findProfile([], "zai")!;
    expect(() => buildSpawnRequest({ machineId: "m", agent: "claude", directory: "/x", profile: zai, model: "claude-opus-4-5" }, "c1")).toThrow(/cannot run on Z.AI/);
    expect(buildSpawnRequest({ machineId: "m", agent: "claude", directory: "/x", profile: zai, model: "opus" }, "c1").model).toBe("default");
  });

  it("stamps Codex speed and keeps no-profile agents on the plain model", () => {
    expect(buildSpawnRequest({ machineId: "m", agent: "codex", directory: "/x", codexFastMode: true }, "c1").environmentVariables).toEqual({ HAPPY_CODEX_FAST_MODE: "1" });
    expect(buildSpawnRequest({ machineId: "m", agent: "codex", directory: "/x" }, "c1").environmentVariables).toEqual({ HAPPY_CODEX_FAST_MODE: "0" });
    const oc = buildSpawnRequest({ machineId: "m", agent: "opencode", directory: "/x", profile: findProfile([], "zai"), model: "x/y" }, "c1");
    expect(oc).toMatchObject({ profileId: "default", model: "x/y", environmentVariables: {} });
  });
  it("omits the backend for daemons that advertise none", () => {
    const r = buildSpawnRequest({ machineId: "m", agent: "codex", directory: "/x", permissionMode: "yolo", model: " gpt-5.5 " }, "c1");
    expect(r).toMatchObject({ spawnBackend: "", permissionMode: "yolo", model: "gpt-5.5", environmentVariables: {} });
  });

  it("builds a Kubernetes request with repos and MCP servers", () => {
    const r = buildSpawnRequest(
      {
        machineId: "m",
        agent: "codex",
        backend: "kubernetes",
        directory: "/workspace/web",
        repoUrl: "acme/web",
        repoRef: " dev ",
        additionalRepos: ["acme/lib", "acme/web", "acme/lib"],
        mcpServers: ["loki"],
      },
      "c1",
    );
    expect(r).toMatchObject({
      spawnBackend: "kubernetes",
      repoUrl: "https://github.com/acme/web",
      repoRef: "dev",
      additionalRepos: ["https://github.com/acme/lib"],
      mcpServers: ["loki"],
      mcpServersSet: true,
    });
    expect(buildSpawnRequest({ machineId: "m", agent: "claude", backend: "kubernetes", directory: "/w", repoUrl: "acme/web", mcpServers: [] }, "c1")).toMatchObject({ mcpServers: [], mcpServersSet: true });
    expect(buildSpawnRequest({ machineId: "m", agent: "claude", backend: "kubernetes", directory: "/w", repoUrl: "acme/web" }, "c1")).toMatchObject({ mcpServers: [], mcpServersSet: false });
  });
});

describe("buildProviderSwitchRequest", () => {
  const live = (meta: SessionMetadata) => ({ ...session("s1", meta, 0), active: true });

  it("restores the same local session with the new routing", () => {
    const s = live({ flavor: "claude", machineId: "m", path: "/home/me/a", model: "opus", permissionMode: "acceptEdits", clientProfileId: "default" });
    const provider = providerSpawn({ profile: findProfile([], "zai"), agent: "claude", model: "GLM-5.1" });
    expect(buildProviderSwitchRequest(s, { spawnBackends: ["local"] }, provider)).toMatchObject({
      type: "spawn-in-directory",
      sessionId: "s1",
      isRestore: true,
      directory: "/home/me/a",
      agent: "claude",
      approvedNewDirectoryCreation: false,
      profileId: "zai",
      model: "GLM-5.1",
      permissionMode: "acceptEdits",
      spawnBackend: "local",
      repoUrl: "",
      mcpServersSet: false,
    });
  });

  it("back to the account login is an explicit empty routing", () => {
    const s = live({ flavor: "claude", machineId: "m", path: "/a", model: "GLM-5.1", clientProfileId: "zai" });
    const r = buildProviderSwitchRequest(s, {}, providerSpawn({ profile: undefined, agent: "claude", model: "default" }));
    expect(r).toMatchObject({ profileId: "default", environmentVariables: {}, model: "default", spawnBackend: "" });
  });

  it("keeps a Kubernetes session's repository", () => {
    const s = live({ flavor: "codex", machineId: "m", path: "/workspace/web", runtimeType: "kubernetes", repoUrl: "https://github.com/acme/web", repoRef: "dev", repoCommit: "abc" });
    const r = buildProviderSwitchRequest(s, { spawnBackends: ["kubernetes"] }, providerSpawn({ profile: findProfile([], "qwen-token-plan-codex"), agent: "codex", model: "qwen3.7-max" }));
    expect(r).toMatchObject({ spawnBackend: "kubernetes", repoUrl: "https://github.com/acme/web", repoRef: "dev", repoCommit: "abc", agent: "codex", profileId: "qwen-token-plan-codex" });
    expect(r.environmentVariables.HAPPY_CODEX_FAST_MODE).toBeUndefined();
    expect(r.environmentVariables.OPENAI_MODEL).toBe("qwen3.7-max");
  });

  it("only offers the switch for restorable Claude/Codex sessions", () => {
    expect(canSwitchProvider(live({ flavor: "claude", machineId: "m", path: "/a" }))).toBe(true);
    expect(canSwitchProvider(live({ flavor: "opencode", machineId: "m", path: "/a" }))).toBe(false);
    expect(canSwitchProvider(live({ flavor: "codex", path: "/a" }))).toBe(false);
    expect(canSwitchProvider({ ...live({ flavor: "claude", machineId: "m", path: "/a" }), archived: true })).toBe(false);
  });
});
