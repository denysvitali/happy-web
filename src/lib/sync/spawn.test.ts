import { describe, expect, it } from "vitest";
import type { MachineItem, SessionItem } from "./account";
import type { MachineMetadata, SessionMetadata } from "./decode";
import {
  abbreviateHome,
  agentsFor,
  availableModes,
  backendRequestValue,
  buildSpawnRequest,
  cleanAdditionalRepos,
  clusterChoices,
  defaultLocalMachine,
  effectiveBranch,
  initialBackend,
  isBranchLookupCandidate,
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

  it("only looks up branches for complete GitHub repositories", () => {
    expect(isBranchLookupCandidate("acme/web")).toBe(true);
    expect(isBranchLookupCandidate("https://github.com/acme/web")).toBe(true);
    expect(isBranchLookupCandidate("acme/")).toBe(false);
    expect(isBranchLookupCandidate("https://gitlab.com/a/b")).toBe(false);
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
      agent: "claude",
      approvedNewDirectoryCreation: true,
      profileId: "default",
      environmentVariables: { HAPPY_INITIAL_PROMPT: "hi" },
      permissionMode: "default",
      model: "default",
      spawnBackend: "local",
      repoUrl: "",
      repoRef: "",
      additionalRepos: [],
      mcpServers: [],
      mcpServersSet: false,
    });
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
