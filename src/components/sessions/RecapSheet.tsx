// On-demand "Catch me up" sheet: renders a calm, grouped reading view of what
// recent sessions concluded (from decrypted lastTurn / Inbox / ToDos) with
// one-tap batch archiving for finished threads. Loaded lazily on first open.
import { Button, SegmentedControl } from "@mantine/core";
import { Archive, BookOpenText, Check, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { AttentionBadge, PodBadge, ProjectSwatch, SessionAvatar, UnreadBadge } from "@/components/status";
import { byRank, metaLine, projectName, type SessionView } from "@/lib/sync/sessionList";
import { EmptyState } from "@/ui/EmptyState";
import { openSheet, SheetBody, SheetFooter } from "@/ui/Sheet";
import classes from "./recap.module.css";

type Scope = "live" | "unread" | "all";

export interface RecapContext {
  views: readonly SessionView[];
  /** Optional project filter when opened from a project header. */
  project?: string | undefined;
  onOpen: (id: string) => void;
  onArchive: (views: readonly SessionView[]) => void;
}

function RecapContent({ ctx, close }: { ctx: RecapContext; close: () => void }) {
  const [scope, setScope] = useState<Scope>("live");
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [archivedIds, setArchivedIds] = useState<ReadonlySet<string>>(() => new Set());

  const filtered = useMemo(() => {
    const base = ctx.views.filter((v) => !v.item.archived && !archivedIds.has(v.id) && (!ctx.project || v.project === ctx.project));
    if (scope === "unread") return base.filter((v) => !!v.unread || v.pending > 0 || v.waitingQuestion);
    if (scope === "live") return base.filter((v) => v.status !== "idle" || v.pending > 0 || !!v.unread || v.waitingQuestion);
    return base;
  }, [ctx.views, ctx.project, scope, archivedIds]);

  const groups = useMemo(() => {
    const map = new Map<string, SessionView[]>();
    for (const v of filtered) {
      const list = map.get(v.project);
      if (list) list.push(v);
      else map.set(v.project, [v]);
    }
    return [...map.entries()]
      .map(([project, items]) => ({ project, items: items.sort(byRank) }))
      .sort((a, b) => b.items[0]!.rank - a.items[0]!.rank || a.project.localeCompare(b.project));
  }, [filtered]);

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const selectedViews = useMemo(() => filtered.filter((v) => checked.has(v.id)), [filtered, checked]);

  const archiveSelected = () => {
    if (selectedViews.length === 0) return;
    ctx.onArchive(selectedViews);
    setArchivedIds((prev) => {
      const next = new Set(prev);
      for (const v of selectedViews) next.add(v.id);
      return next;
    });
    setChecked(new Set());
  };

  return (
    <>
      <SheetBody>
        <div className={classes.head}>
          <p className={classes.lede}>Latest conclusions and open loops across your sessions. Check finished ones to archive them in one step.</p>
          <SegmentedControl
            fullWidth
            size="xs"
            aria-label="Recap scope"
            value={scope}
            onChange={(v) => setScope(v as Scope)}
            data={[
              { value: "live", label: "Active & needs you" },
              { value: "unread", label: "Unread" },
              { value: "all", label: "All unarchived" },
            ]}
          />
        </div>

        {groups.length === 0 ? (
          <EmptyState
            icon={scope === "unread" ? <Sparkles size={20} strokeWidth={1.75} /> : <BookOpenText size={20} strokeWidth={1.75} />}
            tone="gray"
            title={scope === "unread" ? "All caught up" : "Nothing to recap"}
            message={scope === "unread" ? "No unread replies or pending items." : "Switch to “All unarchived” to review older sessions."}
          />
        ) : (
          <div className={classes.groups}>
            {groups.map((g) => (
              <section key={g.project} className={classes.group}>
                <h3 className={classes.groupTitle}>
                  <ProjectSwatch project={g.project} />
                  <span>{projectName(g.project)}</span>
                  <span className={classes.groupCount}>{g.items.length}</span>
                </h3>
                <div className={classes.card}>
                  {g.items.map((v) => {
                    const isChecked = checked.has(v.id);
                    const meta = metaLine(v, { inProject: true });
                    const gitTag =
                      v.gitDirty > 0 || v.gitAhead > 0
                        ? [v.gitDirty > 0 ? `+${v.gitDirty} dirty` : "", v.gitAhead > 0 ? `↑${v.gitAhead} unpushed` : ""].filter(Boolean).join(" · ")
                        : "";
                    return (
                      <div key={v.id} className={classes.row} data-checked={isChecked || undefined}>
                        <button
                          type="button"
                          className={classes.checkBtn}
                          data-checked={isChecked || undefined}
                          aria-label={isChecked ? `Unselect ${v.title}` : `Select ${v.title} to archive`}
                          aria-pressed={isChecked}
                          onClick={() => toggle(v.id)}
                        >
                          {isChecked && <Check size={12} strokeWidth={3} aria-hidden />}
                        </button>
                        <SessionAvatar view={v} size={28} />
                        <div className={classes.rowBody}>
                          <div className={classes.rowTop}>
                            <button
                              type="button"
                              className={classes.titleLink}
                              onClick={() => {
                                close();
                                ctx.onOpen(v.id);
                              }}
                            >
                              {v.title}
                            </button>
                            <span className={classes.when}>{v.ago}</span>
                          </div>
                          {v.statusLine && <p className={classes.summary}>{v.statusLine}</p>}
                          <div className={classes.metaRow}>
                            {meta && <span className={classes.metaText}>{meta}</span>}
                            {gitTag && <span className={classes.gitChip}>{gitTag}</span>}
                            <AttentionBadge count={v.pending} />
                            <PodBadge pod={v.pod} />
                            <UnreadBadge label={v.unread} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </SheetBody>

      <SheetFooter>
        {selectedViews.length > 0 ? (
          <>
            <span className={classes.footerNote}>{selectedViews.length} selected</span>
            <Button variant="default" size="xs" onClick={() => setChecked(new Set())}>
              Clear
            </Button>
            <Button size="xs" leftSection={<Archive size={14} />} onClick={archiveSelected}>
              Archive {selectedViews.length}
            </Button>
          </>
        ) : (
          <Button variant="default" size="xs" onClick={close}>
            Done
          </Button>
        )}
      </SheetFooter>
    </>
  );
}

export function openRecap(ctx: RecapContext): void {
  openSheet({
    title: ctx.project ? `Catch up · ${projectName(ctx.project)}` : "Catch me up",
    size: 560,
    children: (close) => <RecapContent ctx={ctx} close={close} />,
  });
}
