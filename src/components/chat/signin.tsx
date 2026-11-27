// In-chat sign-in card (lib/sync/signIn.ts): the agent's login link and a
// field for the code its page shows, sent back on the session's RPC. The
// session is taken from AgentSession; without one (demo, tests) the card only
// shows the link.
import { Button, TextInput } from "@mantine/core";
import { KeyRound } from "lucide-react";
import { use, useState } from "react";
import { useAccount } from "@/app/auth";
import { useNow } from "@/app/hooks";
import type { Block } from "@/lib/sync/chat";
import { AgentSession } from "./tools/agent-session";
import { Glyph } from "./tools/tool-card";
import classes from "./chat.module.css";

type SignInBlock = Extract<Block, { type: "sign-in" }>;

export function SignInCard({ b }: { b: SignInBlock }) {
  const now = useNow();
  const expired = !!b.request.expiresAt && b.request.expiresAt <= now;
  const open = !b.settled && !expired;
  return (
    <div className={classes.tool} data-attention={open || undefined} data-quiet={!open || undefined} data-bkey={b.key}>
      <div className={classes.permHead}>
        <Glyph icon={KeyRound} kind={open ? "attention" : "other"} />
        <span className={classes.toolTitle}>Sign in to Claude Code</span>
        {!open && <span className={classes.toolSummary}>{b.settled ? "Done" : "Link expired"}</span>}
      </div>
      {open && <SignInForm b={b} />}
      {!b.settled && expired && <div className={classes.signInBody}>This sign-in link expired. Send any message to get a new one.</div>}
    </div>
  );
}

function SignInForm({ b }: { b: SignInBlock }) {
  const sessionId = use(AgentSession);
  const account = useAccount();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    const c = code.trim();
    if (!sessionId || !c || busy) return;
    setBusy(true);
    setError("");
    try {
      await account.submitSignIn(sessionId, b.request.method, c);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={classes.signInBody}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {b.request.lead && <p>{b.request.lead}</p>}
      <Button component="a" href={b.request.url} target="_blank" rel="noopener noreferrer" variant="light" size="xs">
        1. Open the sign-in page
      </Button>
      {sessionId && (
        <div className={classes.signInRow}>
          <TextInput
            size="xs"
            placeholder="2. Paste the code it shows"
            aria-label="Sign-in code"
            value={code}
            onChange={(e) => setCode(e.currentTarget.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={busy || sent}
          />
          <Button type="submit" size="xs" loading={busy} disabled={!code.trim() || sent}>
            Sign in
          </Button>
        </div>
      )}
      {sent && <span className={classes.signInNote}>Signing in… your held message runs once it's done.</span>}
      {error && <span className={classes.permError}>{error}</span>}
    </form>
  );
}
