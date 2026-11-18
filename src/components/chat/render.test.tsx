// Server-renders the demo transcript and every tool body, so a view that
// throws on real-shaped data fails CI (there is no browser in unit tests).
import { MantineProvider } from "@mantine/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildView, type Block, type ToolBlock } from "@/lib/sync/chat";
import { BlockList } from "./blocks";
import { demoChat } from "./fixtures";
import { agentInfo, agentStatus } from "./tools/format";
import { viewFor } from "./tools/registry";

const view = () => {
  const { state, agentState } = demoChat();
  return buildView(state, agentState);
};

function tools(blocks: Block[]): ToolBlock[] {
  return blocks.flatMap((b) => (b.type === "tool" ? [b, ...tools(b.children)] : b.type === "explore" ? b.tools : []));
}

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
