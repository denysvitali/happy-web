// A sub-agent's own page: its prompt, its transcript (same block views as the
// chat, nested agents link deeper) and its answer. Read-only; built from the
// parent session's chat store, so it updates live.
import { Link, useParams } from "@tanstack/react-router";
import { UnstyledButton } from "@mantine/core";
import { ChevronLeft, ExternalLink, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useAccount } from "@/app/auth";
import { useSessions } from "@/app/hooks";
import { BlockView, type PermissionHandler } from "@/components/chat/blocks";
import { Markdown } from "@/components/chat/markdown";
import { AgentGlyph, AgentStatusLabel, AgentTime } from "@/components/chat/tools/agent";
import { AgentSession } from "@/components/chat/tools/agent-session";
import { agentInfo, agentMeta, agentStatus } from "@/components/chat/tools/format";
import { gapOf, useChat, useChatView } from "@/components/chat/transcript";
import chat from "@/components/chat/chat.module.css";
import { findTool, type Block, type ToolBlock } from "@/lib/sync/chat";
import classes from "./agent.module.css";

/** Agent anchors from the top of the view down to (not including) `id`. */
function ancestors(blocks: readonly Block[], id: string, path: ToolBlock[] = []): ToolBlock[] | undefined {
  for (const b of blocks) {
    if (b.type !== "tool") continue; // runs of steps never hold agents
    if (b.id === id) return path;
    const hit = ancestors(b.children, id, [...path, b]);
    if (hit) return hit;
  }
  return undefined;
}

/** Long prompts start clamped. */
function Prompt({ text }: { text: string }) {
  const long = text.length > 600 || text.split("\n").length > 12;
  const [open, setOpen] = useState(!long);
  return (
    <section className={classes.section}>
      <h2 className={classes.label}>Prompt</h2>
      <div className={classes.prompt} data-clamped={!open || undefined}>
        <Markdown text={text} />
      </div>
      {long && (
        <UnstyledButton className={chat.more} onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : "Show all"}
        </UnstyledButton>
      )}
    </section>
  );
}

export function AgentScreen() {
  const { sessionId, toolId } = useParams({ from: "/authed/s/$sessionId/agent/$toolId" });
  const account = useAccount();
  const sessions = useSessions();
  const session = sessions.data?.find((s) => s.id === sessionId);
  const store = useChat(session);
  const view = useChatView(store, session);
  const agent = useMemo(() => (view ? findTool(view.blocks, toolId) : undefined), [view, toolId]);
  const parent = useMemo(() => (view ? ancestors(view.blocks, toolId)?.at(-1) : undefined), [view, toolId]);

  const onPermission: PermissionHandler = async (id, approved, decision) => {
    await account.answerPermission(sessionId, id, approved, decision);
  };
  const back = parent ? (
    <Link to="/s/$sessionId/agent/$toolId" params={{ sessionId, toolId: parent.id }} className={classes.back} aria-label={`Back to ${agentInfo(parent).title}`}>
      <ChevronLeft size={22} strokeWidth={2.4} />
      <span>Agent</span>
    </Link>
  ) : (
    <Link to="/s/$sessionId" params={{ sessionId }} className={classes.back} aria-label="Back to the chat">
      <ChevronLeft size={22} strokeWidth={2.4} />
      <span>Chat</span>
    </Link>
  );

  if (!agent) {
    const loading = sessions.isPending || !view;
    return (
      <>
        <header className={chat.header}>{back}</header>
        <div className={chat.empty}>{loading ? <LoaderCircle size={18} className={chat.spinner} aria-label="Loading" /> : "Sub-agent not found."}</div>
      </>
    );
  }

  const info = agentInfo(agent);
  const status = agentStatus(agent);
  const meta = agentMeta(info, agent.children);
  const blocks = agent.children;
  return (
    <>
      <header className={chat.header}>
        {back}
        <AgentGlyph info={info} kind={status === "failed" ? "error" : "agent"} size={15} />
        <div className={chat.headerMain}>
          <div className={classes.title}>{info.title}</div>
          <div className={classes.sub}>
            <AgentStatusLabel status={status} />
            {meta.map((m) => (
              <span key={m} className={chat.agentMetaItem}>
                {m}
              </span>
            ))}
          </div>
        </div>
        <span className={chat.agentTime}>
          <AgentTime b={agent} status={status} />
        </span>
      </header>
      <div className={chat.scroller}>
        <div className={`${chat.column} ${chat.transcript} ${classes.body}`}>
          {info.prompt && <Prompt text={info.prompt} />}
          {info.settings.length > 0 && (
            <div className={classes.settings}>
              {info.settings.map(([k, v]) => (
                <span key={k} className={chat.chip}>
                  {k}: {v}
                </span>
              ))}
            </div>
          )}
          {blocks.length > 0 && (
            <section className={classes.section}>
              <h2 className={classes.label}>Activity</h2>
              <AgentSession.Provider value={sessionId}>
                <div>
                  {blocks.map((b, i) => (
                    <div key={b.key} className={chat.row} data-gap={gapOf(blocks[i - 1], b)}>
                      <BlockView b={b} onPermission={onPermission} />
                    </div>
                  ))}
                </div>
              </AgentSession.Provider>
            </section>
          )}
          {status === "running" && (
            <div className={classes.note}>
              <LoaderCircle size={14} className={chat.spinner} aria-hidden />
              {blocks.length > 0 ? "Still working; new steps appear here live." : "Started; waiting for its first step."}
            </div>
          )}
          {info.resultText && (
            <section className={classes.section}>
              <h2 className={classes.label}>{status === "failed" ? "Error" : "Answer"}</h2>
              <div className={classes.answer} data-status={status}>
                <Markdown text={info.resultText} />
              </div>
            </section>
          )}
          {info.session && (
            <Link to="/s/$sessionId" params={{ sessionId: info.session }} className={classes.session}>
              <ExternalLink size={13} /> Open its Happy session
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
