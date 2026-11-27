// Server-renders the demo transcript and every tool body, so a view that
// throws on real-shaped data fails CI (there is no browser in unit tests).
import { MantineProvider } from "@mantine/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { addMessages, buildView, emptyChat, type Block, type ToolBlock } from "@/lib/sync/chat";
import { normalizeRecord } from "@/lib/sync/normalize";
import { BlockList } from "./blocks";
import { WorkingRow } from "./working";
import { demoChat, opsAgentState, opsRecords } from "./fixtures";
import { agentInfo, agentStatus } from "./tools/format";
import { viewFor } from "./tools/registry";

const view = () => {
  const { state, agentState } = demoChat();
  return buildView(state, agentState);
};

function tools(blocks: Block[]): ToolBlock[] {
  return blocks.flatMap((b) => (b.type === "tool" ? [b, ...tools(b.children)] : b.type === "steps" || b.type === "work" ? tools(b.items) : []));
}

describe("pending question", () => {
  const ops = () => {
    const msgs = opsRecords.map((r, i) => ({ id: `o${i}`, seq: i + 1, createdAt: i, norm: normalizeRecord(r) }));
    return buildView(addMessages(emptyChat, msgs), opsAgentState);
  };
  it("is answerable in place, without an Allow/Deny bar", () => {
    const out = renderToString(
      <MantineProvider>
        <BlockList blocks={ops().blocks} onPermission={async () => {}} />
      </MantineProvider>,
    );
    expect(out).toContain('role="radio"');
    expect(out).toContain('role="checkbox"');
    expect(out).toContain("Send answers");
    expect(out).not.toContain("Permission required");
  });

  it("answers as an orphan request too", () => {
    const { blocks } = buildView(emptyChat, opsAgentState);
    const out = renderToString(
      <MantineProvider>
        <BlockList blocks={blocks} onPermission={async () => {}} />
      </MantineProvider>,
    );
    expect(out).toContain("Send answers");
  });
});

describe("demo transcript", () => {
  it("renders without throwing", () => {
    const html = renderToString(
      <MantineProvider>
        <BlockList blocks={view().blocks} />
      </MantineProvider>,
    );
    expect(html).toContain("Can you find why the login test is flaky");
    expect(html).toContain("Permission required");
  });

  it("offers code tools and message actions", () => {
    const html = renderToString(
      <MantineProvider>
        <BlockList blocks={view().blocks} />
      </MantineProvider>,
    );
    expect(html).toContain("Wrap long lines");
    expect(html).toContain('aria-label="Actions"');
    // Edit & resend needs a composer to receive the text.
    expect(html).not.toContain("Edit &amp; resend");
  });

  it("renders the working row", () => {
    const html = renderToString(
      <MantineProvider>
        <WorkingRow since={Date.now()} />
      </MantineProvider>,
    );
    expect(html).toContain("Working");
  });

  it("renders every tool body", () => {
    for (const t of tools(view().blocks)) {
      const { Body } = viewFor(t.name);
      expect(() => renderToString(<MantineProvider><Body b={t} /></MantineProvider>), t.name).not.toThrow();
    }
  });

  it("covers sub-agent states and child metadata", () => {
    const all = tools(view().blocks);
    const byId = new Map(all.map((t) => [t.id, t]));
    expect(agentStatus(byId.get("task2")!)).toBe("failed");
    expect(agentStatus(byId.get("agent-th2")!)).toBe("failed");
    expect(agentStatus(byId.get("agent-th1")!)).toBe("running");
    expect(agentStatus(byId.get("nested-1")!)).toBe("completed");
    expect(agentInfo(byId.get("agent-th1")!)).toMatchObject({ model: "gpt-5.1-codex", effort: "high", type: "reviewer" });
    expect(agentInfo(byId.get("agent-th2")!).model).toBe("gpt-5.1-codex-mini");
    expect(agentInfo(byId.get("task1")!).model).toBe("haiku");
    expect(agentInfo(byId.get("nested-1")!).session).toBe("child-session-1");
    // The reviewer's streaming preview renders inside its anchor.
    expect(byId.get("agent-th1")!.children.some((c) => c.type === "text" && c.streaming)).toBe(true);
    const names = new Set(all.map((t) => t.name));
    for (const n of ["Read", "Grep", "Glob", "TodoWrite", "Bash", "WebSearch", "WebFetch", "Write", "MultiEdit", "Edit", "AskUserQuestion", "ExitPlanMode", "mcp__github-actions__list_runs", "shell", "exec_command"]) {
      expect(names.has(n), n).toBe(true);
    }
  });
});

// Antigravity, OpenCode, Grok, Har, Codex, DeepSeek/PrimeAgent: every harness
// renders the same Read / Edit / Write / Bash / Patch views with diffs and content.
describe("ACP and cross-harness tools", () => {
  const acp = (data: object) => ({ role: "agent", content: { type: "acp", data } });
  const grok = (data: object) => ({ role: "agent", content: { type: "grok", data } });
  const codex = (data: object) => ({ role: "agent", content: { type: "codex", data } });
  const records = [
    acp({ type: "tool-call", callId: "x1", name: "grep -rn S4_PORT drivers/", kind: "execute", input: { CommandLine: "grep -rn S4_PORT drivers/", Cwd: "/root/linux", command: "grep -rn S4_PORT drivers/" } }),
    acp({ type: "tool-result", callId: "x1", result: "drivers/hi6402.c:12:#define S4_PORT 0x20", status: "completed" }),
    acp({ type: "tool-call", callId: "r1", name: "File ../tone-thd", kind: "read", input: { Path: "/root/stage2/tone-thd", StartLine: 1, EndLine: 20 } }),
    acp({ type: "tool-result", callId: "r1", result: "#!/bin/sh\nexec tone 1000", status: "completed" }),
    acp({ type: "tool-call", callId: "e1", name: "File ../stereo-tone", kind: "edit", input: { Path: "/root/stage2/stereo-tone" } }),
    acp({ type: "tool-result", callId: "e1", result: [{ type: "diff", path: "/root/stage2/stereo-tone", oldText: "vol=50\n", newText: "vol=80\n" }], status: "completed" }),
    // Antigravity edit_file with Target/Replacement and empty {} rawOutput
    acp({ type: "tool-call", callId: "e2", name: "File ../mainline/ui/bach2-ui.c", kind: "edit", input: { Path: "/root/pmos-tablet/mainline/ui/bach2-ui.c", Target: "int quiet = 0;", Replacement: "int quiet = 1;" } }),
    acp({ type: "tool-result", callId: "e2", result: {}, status: "completed" }),
    // Antigravity write_file with Content and empty {} rawOutput
    acp({ type: "tool-call", callId: "w1", name: "File ../note.txt", kind: "edit", input: { Path: "/root/note.txt", Content: "line1\nline2\n" } }),
    acp({ type: "tool-result", callId: "w1", result: {}, status: "completed" }),
    // Har read_file (no kind, raw ACP content block result)
    acp({ type: "tool-call", callId: "h1", name: "read_file", input: { path: "/workspace/package.json" } }),
    acp({ type: "tool-result", callId: "h1", result: [{ type: "content", content: { type: "text", text: '{"name":"demo"}' } }], status: "completed" }),
    // Grok read_file with target_file + list_dir with kind="other"
    grok({ type: "tool-call", callId: "g1", name: "read_file", kind: "read", input: { target_file: "README.md" } }),
    grok({ type: "tool-result", callId: "g1", result: "1→# Hello", status: "completed" }),
    grok({ type: "tool-call", callId: "g2", name: "list_dir", kind: "other", input: { target_directory: "." } }),
    grok({ type: "tool-result", callId: "g2", result: "- README.md", status: "completed" }),
    // Codex file_change (CodexPatch with changes map)
    codex({ type: "tool-call", callId: "cp1", toolName: "CodexPatch", args: { changes: { "/workspace/app.ts": { kind: "update" } } } }),
    codex({ type: "tool-result", callId: "cp1", result: { status: "completed", summary: "applied", output: "applied" } }),
  ];
  const all = () => {
    const msgs = records.map((r, i) => ({ id: `a${i}`, seq: i + 1, createdAt: i, norm: normalizeRecord(r) }));
    return tools(buildView(addMessages(emptyChat, msgs), { requests: {}, completedRequests: {} }).blocks);
  };
  const body = (t: ToolBlock) => {
    const { Body } = viewFor(t.name);
    return renderToString(<MantineProvider><Body b={t} /></MantineProvider>);
  };

  it("shows commands with output, file reads, writes, patches, and file diffs consistently", () => {
    const [sh, rd, ed, agyEd, agyWr, harRd, grokRd, grokLs, codexPatch] = all();
    expect([sh!.name, rd!.name, ed!.name, agyEd!.name, agyWr!.name, harRd!.name, grokRd!.name, grokLs!.name, codexPatch!.name]).toEqual([
      "Bash",
      "Read",
      "Edit",
      "Edit",
      "Write",
      "Read",
      "Read",
      "LS",
      "CodexPatch",
    ]);
    expect(body(sh!)).toContain("S4_PORT 0x20");
    expect(body(sh!)).toContain("/root/linux");
    expect(viewFor(rd!.name).summary?.(rd!)).toContain("lines 1–20");
    expect(body(rd!)).toContain("exec tone 1000");
    const diff = body(ed!);
    expect(diff).toContain("vol=50");
    expect(diff).toContain("vol=80");
    expect(viewFor(ed!.name).badge?.(ed!)).toBe("+1 −1");
    // Antigravity edit_file renders real diff and badge, never "{}"
    const agyDiff = body(agyEd!);
    expect(agyDiff).toContain("int quiet = 0;");
    expect(agyDiff).toContain("int quiet = 1;");
    expect(agyDiff).not.toContain("{}");
    expect(viewFor(agyEd!.name).badge?.(agyEd!)).toBe("+1 −1");
    // Antigravity write_file renders content and line count, never "{}"
    const agyWrite = body(agyWr!);
    expect(agyWrite).toContain("line1");
    expect(agyWrite).not.toContain("{}");
    expect(viewFor(agyWr!.name).badge?.(agyWr!)).toBe("3 lines");
    // Har JSON file read renders plain file text, not a JSON-highlighted tree
    const harBody = body(harRd!);
    expect(harBody).toContain("&quot;name&quot;:&quot;demo&quot;");
    expect(harBody).not.toContain("content");
    // Grok read_file and list_dir
    expect(viewFor(grokRd!.name).summary?.(grokRd!)).toBe("README.md");
    expect(body(grokRd!)).toContain("# Hello");
    expect(viewFor(grokLs!.name).title).toBe("List");
    // CodexPatch shows changed file summary and path
    expect(viewFor(codexPatch!.name).summary?.(codexPatch!)).toBe("app.ts");
    expect(body(codexPatch!)).toContain("update · /workspace/app.ts");
  });
});
