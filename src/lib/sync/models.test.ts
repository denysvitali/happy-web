import { describe, expect, it } from "vitest";
import { userRecord } from "./chatStore";
import {
  agentKind,
  claudeCatalog,
  codexCatalog,
  currentPermissionMode,
  opencodeCatalog,
  parseSelection,
  permissionModes,
  primeCatalog,
  selectionLabel,
  sendOptions,
  withEffort,
} from "./models";

describe("selection strings", () => {
  it("splits a terminal effort and keeps the context marker on the model", () => {
    expect(parseSelection("opus")).toEqual({ base: "opus" });
    expect(parseSelection("opus:high")).toEqual({ base: "opus", effort: "high" });
    expect(parseSelection("opus:high[1m]")).toEqual({ base: "opus[1m]", effort: "high" });
    expect(parseSelection("provider:model")).toEqual({ base: "provider:model" });
    expect(parseSelection("gpt-5.5:xhigh")).toEqual({ base: "gpt-5.5", effort: "xhigh" });
  });

  it("composes effort before the context marker", () => {
    expect(withEffort("opus", "high")).toBe("opus:high");
    expect(withEffort("opus[1m]", "max")).toBe("opus:max[1m]");
    expect(withEffort("opus:low", "high")).toBe("opus:high");
  });
});

describe("catalogs", () => {
  it("builds the Claude catalog: default first, ids, id:effort", () => {
    const c = claudeCatalog([
      { id: "default", name: "Default", efforts: [] },
      { id: "opus[1m]", name: "Opus (1M)", description: "Most capable", efforts: ["low", "high", "bogus", "high"] },
      { id: "haiku", name: "Haiku", efforts: [] },
      { name: "no id" },
      "junk",
    ]);
    expect(c.groups.map((g) => g.id)).toEqual(["default", "opus[1m]", "haiku"]);
    expect(c.groups[1]!.choices.map((x) => x.value)).toEqual(["opus[1m]", "opus:low[1m]", "opus:high[1m]"]);
    expect(c.groups[1]!.description).toBe("Most capable");
    expect(selectionLabel(c, "opus:high[1m]")).toBe("Opus (1M) · High");
    expect(selectionLabel(c, "opus[1m]:xhigh")).toBe("Opus (1M) · Extra high");
    expect(selectionLabel(c, undefined)).toBe("Default");
    expect(selectionLabel(c, "claude-unknown")).toBe("claude-unknown");
  });

  it("falls back to the built-in Claude tiers", () => {
    expect(claudeCatalog(undefined).groups.map((g) => g.id)).toEqual(["default", "opus", "sonnet", "haiku", "fable"]);
  });

  it("builds the Codex catalog and drops hidden models", () => {
    const c = codexCatalog({
      success: true,
      error: "using cached catalog",
      models: [
        { slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list", supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }], default_reasoning_level: "high" },
        { slug: "mini", displayName: "Mini", supportedReasoningEfforts: ["medium"], defaultReasoningEffort: "medium" },
        { slug: "a", visibility: "hide" },
        { slug: "b", visibility: "none" },
        { slug: "c", hidden: true },
        { slug: "d", showInPicker: false },
      ],
    });
    expect(c?.groups.map((g) => g.id)).toEqual(["default", "gpt-5.5", "mini"]);
    expect(c?.groups[1]!.choices.map((x) => x.value)).toEqual(["gpt-5.5", "gpt-5.5:low", "gpt-5.5:high"]);
    expect(c?.groups[1]!.description).toBe("Default effort: High");
    expect(c?.groups[2]!.choices.map((x) => x.value)).toEqual(["mini", "mini:medium"]);
    expect(c?.notice).toBe("using cached catalog");
    expect(codexCatalog({ success: false, error: "codex missing" })).toBeNull();
  });

  it("builds Prime Agent and OpenCode catalogs", () => {
    const p = primeCatalog([{ id: "anthropic/opus", name: "Opus" }, { id: "anthropic/opus" }, { bad: 1 }], [{ id: "high", name: "High" }]);
    expect(p.groups.map((g) => g.id)).toEqual(["anthropic/opus"]);
    expect(p.efforts).toEqual([{ value: "high", label: "High" }]);
    expect(opencodeCatalog([{ id: "x/y" }]).groups[0]!.label).toBe("x/y");
  });
});

describe("sending a switch", () => {
  const claude = claudeCatalog(undefined);

  it("sends the selection, default as null", () => {
    expect(sendOptions("claude", claude, { model: "opus:high", permissionMode: "plan" })).toEqual({ model: "opus:high", permissionMode: "plan" });
    expect(sendOptions("claude", claude, { model: "default", permissionMode: "default" })).toEqual({ model: null, permissionMode: "default" });
    expect(sendOptions("codex", { groups: [] }, { permissionMode: "yolo" })).toEqual({ model: null, permissionMode: "yolo" });
  });

  it("sends OpenCode and Prime models only when listed, Prime effort separately", () => {
    const oc = opencodeCatalog([{ id: "a/b" }]);
    expect(sendOptions("opencode", oc, { model: "a/b", permissionMode: "default" }).model).toBe("a/b");
    expect(sendOptions("opencode", oc, { model: "c/d", permissionMode: "default" }).model).toBeNull();
    const p = primeCatalog([{ id: "p:m" }], [{ id: "high" }]);
    expect(sendOptions("prime", p, { model: "p:m", reasoningEffort: "high", permissionMode: "default" })).toEqual({ model: "p:m", reasoningEffort: "high", permissionMode: "default" });
    expect(sendOptions("prime", p, { reasoningEffort: "ultra", permissionMode: "default" }).reasoningEffort).toBeUndefined();
  });

  it("writes the full user message meta", () => {
    expect(userRecord("hi")).toEqual({ role: "user", content: { type: "text", text: "hi" }, meta: { sentFrom: "web" } });
    expect(userRecord("hi", { model: "opus:high", permissionMode: "acceptEdits" }).meta).toEqual({
      sentFrom: "web",
      permissionMode: "acceptEdits",
      model: "opus:high",
      fallbackModel: null,
    });
    expect(userRecord("hi", { model: "p", permissionMode: "default", reasoningEffort: "high" }).meta).toMatchObject({ reasoning_effort: "high" });
    expect(userRecord("see", undefined, [{ mime: "image/png", data: "AAAA" }]).content).toEqual([
      { type: "text", text: "see" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ]);
  });
});

describe("permission modes", () => {
  it("differs between Codex and the rest", () => {
    expect(agentKind("codex")).toBe("codex");
    expect(agentKind("prime-agent")).toBe("prime");
    expect(agentKind(undefined)).toBe("claude");
    expect(permissionModes("codex").map((m) => m.value)).toEqual(["default", "read-only", "safe-yolo", "yolo"]);
    expect(permissionModes("claude").map((m) => m.value)).toEqual(["default", "acceptEdits", "plan", "bypassPermissions"]);
    expect(currentPermissionMode("codex", "yolo")).toBe("yolo");
    expect(currentPermissionMode("codex", "bypassPermissions")).toBe("yolo");
    expect(currentPermissionMode("claude", undefined)).toBe("bypassPermissions");
  });
});
