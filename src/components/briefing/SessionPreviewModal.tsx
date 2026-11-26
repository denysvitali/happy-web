import { Button, Modal, TextInput } from "@mantine/core";
import { Archive, Clock, SendHorizontal } from "lucide-react";
import { useState } from "react";
import { ProjectSwatch } from "@/components/status";
import { formatAgo } from "@/lib/sync/sessionList";
import { FootprintChips } from "./FootprintChips";
import { STAGE_LABEL, type BriefingSession, type Space } from "./model";
import classes from "./briefing.module.css";

interface SessionPreviewModalProps {
  session: BriefingSession | null;
  space: Space | undefined;
  now: number;
  onClose: () => void;
  onSendFollowUp: (session: BriefingSession, text: string) => void;
  onSnooze: (session: BriefingSession) => void;
  onArchiveDistill: (session: BriefingSession) => void;
}

/** Lightweight session handoff inspector for the mock prototype. */
export function SessionPreviewModal({ session, space, now, onClose, onSendFollowUp, onSnooze, onArchiveDistill }: SessionPreviewModalProps) {
  const [draft, setDraft] = useState("");
  if (!session) return null;

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSendFollowUp(session, text);
    setDraft("");
  };

  return (
    <Modal opened onClose={onClose} lockScroll={false} title={session.state.title} size={520} centered>
      <div className={classes.modalBody}>
        <div className={classes.cardMetaRow}>
          <span className={classes.spaceTag}>
            <ProjectSwatch project={space?.swatchKey ?? session.repo} />
            {space?.name ?? "Unassigned"}
          </span>
          <span className={classes.pill} data-tone={session.status === "thinking" ? "working" : session.state.stage === "blocked" ? "stalled" : "accent"}>
            {STAGE_LABEL[session.state.stage]}
          </span>
          <span className={classes.when}>{formatAgo(session.lastActivityAt, now)}</span>
        </div>

        <p className={classes.cardBody}>
          <strong>Now:</strong> {session.state.now}
        </p>
        {session.state.next && (
          <div className={classes.nextLine}>
            <span className={classes.nextLabel}>Next</span>
            <span>{session.state.next}</span>
          </div>
        )}

        <FootprintChips footprint={session.footprint} branch={session.branch} host={session.host} showClean />

        {session.transcriptExcerpt.length > 0 && (
          <div className={classes.transcriptBox}>
            {session.transcriptExcerpt.map((line, i) => (
              <div key={i} className={classes.transcriptLine}>
                <span className={classes.transcriptRole}>{line.role === "user" ? "You" : session.agent}</span>
                {line.text}
              </div>
            ))}
          </div>
        )}

        {session.status !== "archived" && (
          <div className={classes.replyRow}>
            <TextInput
              className={classes.replyInput}
              size="xs"
              placeholder="Send a simulated follow-up…"
              aria-label="Send a simulated follow-up"
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
            />
            <Button size="xs" leftSection={<SendHorizontal size={13} />} disabled={!draft.trim()} onClick={send}>
              Send
            </Button>
          </div>
        )}

        <div className={classes.modalFooter}>
          {session.status !== "archived" && (
            <>
              <Button
                variant="default"
                size="xs"
                leftSection={<Clock size={14} />}
                onClick={() => {
                  onSnooze(session);
                  onClose();
                }}
              >
                Snooze 1d
              </Button>
              <Button
                variant="light"
                size="xs"
                leftSection={<Archive size={14} />}
                onClick={() => {
                  onArchiveDistill(session);
                  onClose();
                }}
              >
                Archive &amp; distill
              </Button>
            </>
          )}
          <Button variant="subtle" size="xs" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
