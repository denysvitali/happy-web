import { Button, Modal } from "@mantine/core";
import { AlertTriangle, Archive, CheckCircle2, Clock, ExternalLink, Sparkles } from "lucide-react";
import { ProjectSwatch } from "@/components/status";
import { formatAgo } from "@/lib/sync/sessionList";
import { EmptyState } from "@/ui/EmptyState";
import { FootprintChips } from "./FootprintChips";
import { resolveSpaceId, sweepSafety, type BriefingSession, type Space } from "./model";
import classes from "./briefing.module.css";

interface SweepModalProps {
  opened: boolean;
  onClose: () => void;
  candidates: BriefingSession[];
  spaces: readonly Space[];
  now: number;
  onArchiveDistill: (session: BriefingSession) => void;
  onSnooze: (session: BriefingSession) => void;
  onInspect: (session: BriefingSession) => void;
}

/** 30-second Sweep: prune idle/resolved sessions without fearing lost code. */
export function SweepModal({ opened, onClose, candidates, spaces, now, onArchiveDistill, onSnooze, onInspect }: SweepModalProps) {
  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const current = candidates[0];
  const space = current ? spaceById.get(resolveSpaceId(current, spaces)) : undefined;
  const safety = current ? sweepSafety(current) : "clean";

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      lockScroll={false}
      title={candidates.length > 0 ? `Sweep · ${candidates.length} remaining` : "Sweep"}
      size={480}
      centered
    >
      {!current ? (
        <EmptyState
          icon={<Sparkles size={22} strokeWidth={1.75} />}
          tone="green"
          title="All swept"
          message="Only active threads remain. Archived takeaways were saved into each Space's Milestone Log."
          action={
            <Button radius="xl" onClick={onClose}>
              Back to Briefing
            </Button>
          }
        />
      ) : (
        <div className={classes.modalBody}>
          <div className={classes.safetyBanner} data-safety={safety}>
            {safety === "clean" ? (
              <>
                <CheckCircle2 size={16} strokeWidth={2.2} aria-hidden />
                <span>Clean working tree &amp; stopped — safe to archive.</span>
              </>
            ) : (
              <>
                <AlertTriangle size={16} strokeWidth={2.2} aria-hidden />
                <span>Heads up: uncommitted changes or live compute in this session.</span>
              </>
            )}
          </div>

          <div className={classes.card}>
            <div className={classes.cardMetaRow}>
              <span className={classes.spaceTag}>
                <ProjectSwatch project={space?.swatchKey ?? current.repo} />
                {space?.name ?? "Unassigned"}
              </span>
              <span className={classes.when}>quiet {formatAgo(current.lastActivityAt, now)}</span>
            </div>
            <h3 className={classes.cardTitle}>{current.state.title}</h3>
            <p className={classes.cardBody}>{current.state.now}</p>
            {current.state.next && (
              <div className={classes.nextLine}>
                <span className={classes.nextLabel}>Next</span>
                <span>{current.state.next}</span>
              </div>
            )}
            <FootprintChips footprint={current.footprint} branch={current.branch} host={current.host} showClean />
          </div>

          <div className={classes.modalFooter}>
            <Button
              variant="subtle"
              size="xs"
              leftSection={<ExternalLink size={14} />}
              onClick={() => {
                onClose();
                onInspect(current);
              }}
            >
              Inspect
            </Button>
            <Button variant="default" size="xs" leftSection={<Clock size={14} />} onClick={() => onSnooze(current)}>
              Snooze 1d
            </Button>
            <Button
              size="xs"
              color={safety === "caution" ? "orange" : "blue"}
              leftSection={<Archive size={14} />}
              onClick={() => onArchiveDistill(current)}
            >
              Archive &amp; distill
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
