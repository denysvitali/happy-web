// /briefing: interactive prototype of the Briefing + Spaces + Living Notebook +
// Sweep model for tackling multi-day, many-session distraction. Uses sample
// data with full local interactivity (no server writes, no account required).
import { Button, Textarea, TextInput, Tooltip, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpen,
  Broom,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Clock,
  Compass,
  Cpu,
  ExternalLink,
  Flag,
  LayoutList,
  Pencil,
  RotateCcw,
  Search,
  SendHorizontal,
  ShieldQuestion,
  Sparkles,
  SunMoon,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { BrandMark } from "@/components/brand";
import { FootprintChips } from "@/components/briefing/FootprintChips";
import { createMockBriefing, type BriefingDataset } from "@/components/briefing/mockData";
import {
  formatRules,
  isSnoozed,
  isSweepCandidate,
  openTurnsOf,
  resolveSpaceId,
  searchBriefing,
  STAGE_LABEL,
  summarizeSpaces,
  sweepSafety,
  TURN_LABEL,
  type BriefingSession,
  type NotebookProposal,
  type Space,
  type SpaceMomentum,
  type SpaceSummary,
  type TurnItem,
} from "@/components/briefing/model";
import { SessionPreviewModal } from "@/components/briefing/SessionPreviewModal";
import { SweepModal } from "@/components/briefing/SweepModal";
import { ProjectSwatch } from "@/components/status";
import { formatAgo } from "@/lib/sync/sessionList";
import { EmptyState } from "@/ui/EmptyState";
import { IconButton } from "@/ui/IconButton";
import { SearchField } from "@/ui/SearchField";
import { showUndo } from "@/ui/undoToast";
import classes from "@/components/briefing/briefing.module.css";

const DAY_MS = 24 * 3600_000;
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function momentumMeta(m: SpaceMomentum, summary: SpaceSummary, now: number): { label: string; tone?: "attention" | "working" | "stalled" | "accent" } {
  if (m === "stalled") {
    const ref = summary.openTurns[0]?.createdAt ?? summary.lastActivityAt;
    return { label: `Stalled ${formatAgo(ref, now)}`, tone: "stalled" };
  }
  if (m === "needs_you") return { label: `${summary.openTurns.length} needs you`, tone: "attention" };
  if (m === "working") return { label: `${summary.workingCount} working`, tone: "working" };
  if (m === "warm") return { label: `${summary.activeCount} active`, tone: "accent" };
  return { label: "Quiet" };
}

function TurnIcon({ kind }: { kind: TurnItem["kind"] }) {
  if (kind === "approval") return <ShieldQuestion size={14} strokeWidth={2.2} aria-hidden />;
  if (kind === "question") return <CircleHelp size={14} strokeWidth={2.2} aria-hidden />;
  if (kind === "blocked") return <CircleAlert size={14} strokeWidth={2.2} aria-hidden />;
  return <Flag size={14} strokeWidth={2.2} aria-hidden />;
}

export function BriefingScreen() {
  const [data, setData] = useState<BriefingDataset>(() => createMockBriefing());
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sweepOpen, setSweepOpen] = useState(false);
  const [workingOpen, setWorkingOpen] = useState(false);
  const [showQuiet, setShowQuiet] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [replyOpenId, setReplyOpenId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [editingNotebook, setEditingNotebook] = useState(false);
  const [editGoal, setEditGoal] = useState("");
  const [editSummary, setEditSummary] = useState("");

  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("light");

  const { now, spaces, sessions, turns } = data;
  const spaceById = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  const summaries = useMemo(() => summarizeSpaces(spaces, sessions, turns, now), [spaces, sessions, turns, now]);
  const activeSummaries = useMemo(() => summaries.filter((s) => s.momentum !== "quiet"), [summaries]);
  const quietSummaries = useMemo(() => summaries.filter((s) => s.momentum === "quiet"), [summaries]);

  const openTurns = useMemo(() => openTurnsOf(turns, now), [turns, now]);
  const workingSessions = useMemo(
    () => sessions.filter((s) => s.status === "thinking" && !isSnoozed(s.snoozedUntil, now)),
    [sessions, now],
  );
  const sweepCandidates = useMemo(
    () =>
      sessions
        .filter((s) => isSweepCandidate(s, now))
        .sort((a, b) => Number(sweepSafety(a) === "caution") - Number(sweepSafety(b) === "caution") || a.lastActivityAt - b.lastActivityAt),
    [sessions, now],
  );
  const cleanSweepCount = useMemo(() => sweepCandidates.filter((s) => sweepSafety(s) === "clean").length, [sweepCandidates]);
  const cautionSweepCount = sweepCandidates.length - cleanSweepCount;

  const activeSpaceSummary = selectedSpaceId ? summaries.find((s) => s.space.id === selectedSpaceId) : undefined;
  const previewSession = previewId ? (sessionById.get(previewId) ?? null) : null;
  const searchHits = useMemo(() => (searchOpen && query.trim() ? searchBriefing(query, spaces, sessions) : []), [searchOpen, query, spaces, sessions]);

  // ---- mutations with undo ----

  const updateData = (fn: (prev: BriefingDataset) => BriefingDataset, undoMessage?: string) => {
    let snapshot: BriefingDataset | null = null;
    setData((prev) => {
      snapshot = prev;
      return fn(prev);
    });
    if (undoMessage) {
      showUndo(undoMessage, () => {
        if (snapshot) setData(snapshot);
      });
    }
  };

  const handleTurnAction = (turn: TurnItem, outcome: { label: string; reply?: string; resumeWorking?: boolean; snooze?: boolean }) => {
    updateData((prev) => {
      const nextTurns = prev.turns.map((t) => {
        if (t.id !== turn.id) return t;
        if (outcome.snooze) return { ...t, snoozedUntil: prev.now + DAY_MS };
        return { ...t, resolved: true, reply: outcome.reply };
      });
      const nextSessions = prev.sessions.map((s) => {
        if (s.id !== turn.sessionId) return s;
        if (outcome.snooze) return s;
        if (outcome.resumeWorking) {
          return {
            ...s,
            status: "thinking" as const,
            lastActivityAt: prev.now,
            state: {
              ...s.state,
              owner: "agent" as const,
              stage: "building" as const,
              now: outcome.reply ? `Continuing with: "${outcome.reply}".` : "Command approved; running next step.",
              updatedAt: prev.now,
            },
            transcriptExcerpt: outcome.reply
              ? [...s.transcriptExcerpt, { role: "user" as const, text: outcome.reply }]
              : s.transcriptExcerpt,
          };
        }
        return {
          ...s,
          state: { ...s.state, owner: "none" as const, stage: "done" as const, updatedAt: prev.now },
        };
      });
      return { ...prev, turns: nextTurns, sessions: nextSessions };
    }, outcome.label);
    if (replyOpenId === turn.id) {
      setReplyOpenId(null);
      setReplyDraft("");
    }
  };

  const handleArchiveDistill = (session: BriefingSession) => {
    const sid = resolveSpaceId(session, spaces);
    updateData((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id === session.id
          ? { ...s, status: "archived" as const, footprint: { ...s.footprint, podLive: false } }
          : s,
      ),
      turns: prev.turns.map((t) => (t.sessionId === session.id ? { ...t, resolved: true } : t)),
      spaces: prev.spaces.map((sp) =>
        sp.id === sid
          ? {
              ...sp,
              notebook: {
                ...sp.notebook,
                milestones: [
                  { id: `m-${session.id}-${prev.now}`, at: prev.now, text: `${session.state.title} — ${session.state.now}`, sessionId: session.id },
                  ...sp.notebook.milestones,
                ],
                updatedAt: prev.now,
              },
            }
          : sp,
      ),
    }), `Archived & saved takeaway to ${spaceById.get(sid)?.name ?? "Space"}`);
  };

  const handleSnoozeSession = (session: BriefingSession) => {
    updateData(
      (prev) => ({
        ...prev,
        sessions: prev.sessions.map((s) => (s.id === session.id ? { ...s, snoozedUntil: prev.now + DAY_MS } : s)),
        turns: prev.turns.map((t) => (t.sessionId === session.id ? { ...t, snoozedUntil: prev.now + DAY_MS } : t)),
      }),
      `Snoozed "${session.state.title}" for 1 day`,
    );
  };

  const handleSendFollowUp = (session: BriefingSession, text: string) => {
    updateData((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id === session.id
          ? {
              ...s,
              status: "thinking" as const,
              lastActivityAt: prev.now,
              state: { ...s.state, owner: "agent" as const, stage: "building" as const, now: `Working on: ${text}`, updatedAt: prev.now },
              transcriptExcerpt: [...s.transcriptExcerpt, { role: "user" as const, text }],
            }
          : s,
      ),
    }));
    notifications.show({ message: `Sent follow-up to "${session.state.title}"` });
  };

  const handleProposal = (spaceId: string, proposal: NotebookProposal, accept: boolean) => {
    updateData((prev) => ({
      ...prev,
      spaces: prev.spaces.map((sp) => {
        if (sp.id !== spaceId) return sp;
        const rest = sp.notebook.proposals.filter((p) => p.id !== proposal.id);
        if (!accept) return { ...sp, notebook: { ...sp.notebook, proposals: rest } };
        return {
          ...sp,
          notebook: {
            ...sp.notebook,
            proposals: rest,
            knownFacts: proposal.kind === "fact" ? [proposal.text, ...sp.notebook.knownFacts] : sp.notebook.knownFacts,
            blockers: proposal.kind === "blocker" ? [proposal.text, ...sp.notebook.blockers] : sp.notebook.blockers,
            milestones:
              proposal.kind === "milestone"
                ? [{ id: `m-${proposal.id}`, at: prev.now, text: proposal.text, sessionId: proposal.fromSessionId }, ...sp.notebook.milestones]
                : sp.notebook.milestones,
            updatedAt: prev.now,
          },
        };
      }),
    }), accept ? "Added note to Living Notebook" : "Dismissed notebook suggestion");
  };

  const startEditNotebook = (space: Space) => {
    setEditGoal(space.notebook.goal);
    setEditSummary(space.notebook.summary);
    setEditingNotebook(true);
  };

  const saveNotebook = (spaceId: string) => {
    updateData((prev) => ({
      ...prev,
      spaces: prev.spaces.map((sp) =>
        sp.id === spaceId
          ? { ...sp, notebook: { ...sp.notebook, goal: editGoal.trim() || sp.notebook.goal, summary: editSummary.trim() || sp.notebook.summary, updatedAt: prev.now } }
          : sp,
      ),
    }));
    setEditingNotebook(false);
  };

  const resetDemo = () => {
    setData(createMockBriefing());
    setSelectedSpaceId(null);
    setEditingNotebook(false);
    setSearchOpen(false);
    setQuery("");
    notifications.show({ message: "Reset Briefing prototype data" });
  };

  const openSpace = (id: string | null) => {
    setSelectedSpaceId(id);
    setEditingNotebook(false);
    setSearchOpen(false);
    setQuery("");
  };

  return (
    <div className={classes.shell}>
      {/* Desktop Left Rail */}
      <aside className={classes.rail} aria-label="Spaces navigation">
        <div className={classes.railHead}>
          <Link to="/" className={classes.brand} aria-label="Back to classic Happy">
            <BrandMark size={20} />
            <span>Happy</span>
          </Link>
          <span className={classes.previewTag}>Preview</span>
        </div>

        <div className={classes.railBody}>
          <div className={classes.railSection}>
            <button
              type="button"
              className={classes.railItem}
              data-active={selectedSpaceId === null || undefined}
              onClick={() => openSpace(null)}
            >
              <Compass size={16} strokeWidth={2} aria-hidden />
              <span className={classes.railItemName}>Briefing</span>
              {openTurns.length > 0 && (
                <span className={classes.railCount} data-tone="attention">
                  {openTurns.length}
                </span>
              )}
            </button>
            <button type="button" className={classes.railItem} onClick={() => setSweepOpen(true)}>
              <Broom size={16} strokeWidth={2} aria-hidden />
              <span className={classes.railItemName}>Sweep</span>
              {sweepCandidates.length > 0 && <span className={classes.railCount}>{sweepCandidates.length}</span>}
            </button>
          </div>

          <div className={classes.railSection}>
            <div className={classes.railLabel}>
              <span>Active Spaces</span>
              <span>{activeSummaries.length}</span>
            </div>
            {activeSummaries.map((s) => (
              <button
                key={s.space.id}
                type="button"
                className={classes.railItem}
                data-active={selectedSpaceId === s.space.id || undefined}
                onClick={() => openSpace(s.space.id)}
              >
                <ProjectSwatch project={s.space.swatchKey} />
                <span className={classes.railItemName}>{s.space.name}</span>
                {s.openTurns.length > 0 ? (
                  <span className={classes.railCount} data-tone="attention">
                    {s.openTurns.length}
                  </span>
                ) : (
                  <span className={classes.railDot} data-momentum={s.momentum} aria-hidden />
                )}
              </button>
            ))}
          </div>

          {quietSummaries.length > 0 && (
            <div className={classes.railSection}>
              <div className={classes.railLabel}>
                <span>Quiet Spaces</span>
                <span>{quietSummaries.length}</span>
              </div>
              {quietSummaries.map((s) => (
                <button
                  key={s.space.id}
                  type="button"
                  className={classes.railItem}
                  data-active={selectedSpaceId === s.space.id || undefined}
                  onClick={() => openSpace(s.space.id)}
                >
                  <ProjectSwatch project={s.space.swatchKey} />
                  <span className={classes.railItemName}>{s.space.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={classes.railFooter}>
          <Link to="/" className={classes.classicLink}>
            <ArrowLeft size={15} aria-hidden />
            Classic sessions view
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <div className={classes.main}>
        <header className={classes.topBar}>
          {selectedSpaceId && (
            <span className={classes.mobileOnly}>
              <IconButton label="Back to Briefing" icon={<ArrowLeft size={18} />} onClick={() => openSpace(null)} />
            </span>
          )}
          <h1 className={classes.topTitle}>{activeSpaceSummary ? activeSpaceSummary.space.name : "Briefing"}</h1>

          <div className={classes.topActions}>
            <Tooltip label="Search spaces, sessions & milestones" openDelay={300}>
              <IconButton
                label="Search"
                icon={searchOpen ? <X size={17} /> : <Search size={17} />}
                onClick={() => {
                  setSearchOpen((v) => !v);
                  if (searchOpen) setQuery("");
                }}
              />
            </Tooltip>
            {sweepCandidates.length > 0 && (
              <Tooltip label="Sweep quiet sessions" openDelay={300}>
                <Button
                  variant="light"
                  size="xs"
                  radius="xl"
                  aria-label={`Sweep ${sweepCandidates.length} quiet sessions`}
                  leftSection={<Broom size={14} />}
                  onClick={() => setSweepOpen(true)}
                >
                  {sweepCandidates.length}
                </Button>
              </Tooltip>
            )}
            <Tooltip label="Reset mock data" openDelay={300}>
              <IconButton label="Reset mock data" icon={<RotateCcw size={16} />} onClick={resetDemo} />
            </Tooltip>
            <Tooltip label={scheme === "dark" ? "Light mode" : "Dark mode"} openDelay={300}>
              <IconButton
                label="Toggle theme"
                icon={<SunMoon size={17} />}
                onClick={() => setColorScheme(scheme === "dark" ? "light" : "dark")}
              />
            </Tooltip>
            <span className={classes.mobileOnly}>
              <Tooltip label="Classic sessions view" openDelay={300}>
                <Link to="/" className={classes.classicIconLink} aria-label="Classic sessions view">
                  <LayoutList size={17} strokeWidth={1.9} aria-hidden />
                </Link>
              </Tooltip>
            </span>
          </div>
        </header>

        {/* Mobile Horizontal Space Switcher (replaces nested folder tree) */}
        <nav className={classes.spaceStrip} aria-label="Spaces">
          <button
            type="button"
            className={classes.spacePill}
            data-active={selectedSpaceId === null || undefined}
            onClick={() => openSpace(null)}
          >
            Briefing
            {openTurns.length > 0 && <span>· {openTurns.length}</span>}
          </button>
          {activeSummaries.map((s) => (
            <button
              key={s.space.id}
              type="button"
              className={classes.spacePill}
              data-active={selectedSpaceId === s.space.id || undefined}
              onClick={() => openSpace(s.space.id)}
            >
              <span className={classes.railDot} data-momentum={s.momentum} aria-hidden />
              {s.space.name}
            </button>
          ))}
        </nav>

        {/* Quick Search Bar (Recall) */}
        {searchOpen && (
          <div className={classes.searchBarWrap}>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Recall any space, session, notebook fact, or milestone…"
              label="Search briefing"
            />
          </div>
        )}

        <main className={classes.scroll}>
          <div className={classes.inner}>
            {searchOpen && query.trim() ? (
              <section className={classes.section} aria-label="Search results">
                <div className={classes.sectionHead}>
                  <h2 className={classes.sectionTitle}>
                    Recall <span className={classes.sectionCount}>{searchHits.length}</span>
                  </h2>
                </div>
                {searchHits.length === 0 ? (
                  <EmptyState
                    icon={<Search size={20} strokeWidth={1.75} />}
                    tone="gray"
                    title="No matches"
                    message="Try a repo name, machine, blocker, or archived topic (e.g. Public, bach2, Protobuf)."
                  />
                ) : (
                  <div className={classes.searchResults}>
                    {searchHits.map((hit) => (
                      <button
                        key={`${hit.kind}-${hit.id}`}
                        type="button"
                        className={classes.searchRow}
                        onClick={() => {
                          if (hit.kind === "session") setPreviewId(hit.id);
                          else openSpace(hit.spaceId);
                        }}
                      >
                        <div className={classes.searchRowBody}>
                          <div className={classes.searchRowTitle}>{hit.title}</div>
                          <div className={classes.searchRowSub}>{hit.subtitle}</div>
                        </div>
                        <span className={classes.pill}>
                          {hit.kind === "space" ? "Space" : hit.kind === "milestone" ? "Milestone" : hit.archived ? "Archived" : hit.spaceName}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            ) : activeSpaceSummary ? (
              /* ---- ALTITUDE 2: ISOLATED SPACE + LIVING NOTEBOOK ---- */
              <SpaceView
                summary={activeSpaceSummary}
                now={now}
                editing={editingNotebook}
                editGoal={editGoal}
                editSummary={editSummary}
                onEditGoal={setEditGoal}
                onEditSummary={setEditSummary}
                onStartEdit={() => startEditNotebook(activeSpaceSummary.space)}
                onCancelEdit={() => setEditingNotebook(false)}
                onSaveEdit={() => saveNotebook(activeSpaceSummary.space.id)}
                onProposal={handleProposal}
                onOpenSession={(s) => setPreviewId(s.id)}
                onTurnAction={handleTurnAction}
                replyOpenId={replyOpenId}
                replyDraft={replyDraft}
                onToggleReply={(id) => {
                  setReplyOpenId((cur) => (cur === id ? null : id));
                  setReplyDraft("");
                }}
                onReplyDraft={setReplyDraft}
              />
            ) : (
              /* ---- ALTITUDE 1: BRIEFING (YOUR TURN + PROJECT RADAR + AMBIENT + SWEEP) ---- */
              <>
                {/* 1. Unified Your Turn */}
                <section className={classes.section} aria-label="Your turn">
                  <div className={classes.sectionHead}>
                    <h2 className={classes.sectionTitle} data-tone={openTurns.length > 0 ? "attention" : undefined}>
                      <CircleAlert size={13} strokeWidth={2.4} aria-hidden />
                      Your turn
                      <span className={classes.sectionCount}>{openTurns.length}</span>
                    </h2>
                    <span className={classes.sectionHint}>Approvals, decisions &amp; ready work</span>
                  </div>

                  {openTurns.length === 0 ? (
                    <div className={classes.card}>
                      <EmptyState
                        icon={<Sparkles size={20} strokeWidth={1.75} />}
                        tone="green"
                        title="Nothing waiting on you"
                        message="All approvals, questions, and reviews are cleared. Agents will surface here only when they need your brain."
                      />
                    </div>
                  ) : (
                    <div className={classes.stack}>
                      {openTurns.map((turn) => (
                        <TurnCard
                          key={turn.id}
                          turn={turn}
                          space={spaceById.get(turn.spaceId)}
                          session={sessionById.get(turn.sessionId)}
                          now={now}
                          replyOpen={replyOpenId === turn.id}
                          replyDraft={replyDraft}
                          onToggleReply={() => {
                            setReplyOpenId((cur) => (cur === turn.id ? null : turn.id));
                            setReplyDraft("");
                          }}
                          onReplyDraft={setReplyDraft}
                          onAction={(outcome) => handleTurnAction(turn, outcome)}
                          onInspect={() => setPreviewId(turn.sessionId)}
                        />
                      ))}
                    </div>
                  )}
                </section>

                {/* 2. Project Radar (1 card per active Space) */}
                <section className={classes.section} aria-label="Project radar">
                  <div className={classes.sectionHead}>
                    <h2 className={classes.sectionTitle}>
                      <Compass size={13} strokeWidth={2.4} aria-hidden />
                      Project radar
                      <span className={classes.sectionCount}>{activeSummaries.length}</span>
                    </h2>
                    {quietSummaries.length > 0 && (
                      <Button variant="subtle" size="xs" onClick={() => setShowQuiet((v) => !v)}>
                        {showQuiet ? "Hide quiet" : `${quietSummaries.length} quiet hidden`}
                      </Button>
                    )}
                  </div>

                  <div className={classes.radarGrid}>
                    {[...activeSummaries, ...(showQuiet ? quietSummaries : [])].map((s) => {
                      const meta = momentumMeta(s.momentum, s, now);
                      return (
                        <button
                          key={s.space.id}
                          type="button"
                          className={`${classes.card} ${classes.cardInteractive}`}
                          onClick={() => openSpace(s.space.id)}
                        >
                          <div className={classes.cardMetaRow}>
                            <span className={classes.spaceTag}>
                              <ProjectSwatch project={s.space.swatchKey} />
                              {s.space.name}
                            </span>
                            <span className={classes.pill} data-tone={meta.tone}>
                              {meta.label}
                            </span>
                          </div>
                          <p className={classes.cardBody}>{s.space.notebook.summary}</p>
                          <div className={classes.chips}>
                            {s.dirtyCount > 0 && (
                              <span className={classes.chip} data-tone="amber">
                                {s.dirtyCount} dirty {s.dirtyCount === 1 ? "repo" : "repos"}
                              </span>
                            )}
                            {s.livePodCount > 0 && (
                              <span className={classes.chip} data-tone="accent">
                                <Cpu size={11} strokeWidth={2.2} aria-hidden />
                                {s.livePodCount} {s.livePodCount === 1 ? "pod" : "pods"}
                              </span>
                            )}
                            {s.pausedCount > 0 && <span className={classes.chip}>{s.pausedCount} paused</span>}
                            {s.proposalCount > 0 && (
                              <span className={classes.chip} data-tone="accent">
                                <BookOpen size={11} strokeWidth={2.2} aria-hidden />
                                {s.proposalCount} note update
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* 3. Calm Ambient Working Strip */}
                {workingSessions.length > 0 && (
                  <section className={classes.section} aria-label="Working in background">
                    <div className={classes.ambientStrip}>
                      <button
                        type="button"
                        className={classes.ambientBtn}
                        aria-expanded={workingOpen}
                        onClick={() => setWorkingOpen((v) => !v)}
                      >
                        <span className={classes.pulseDot} aria-hidden />
                        <span>
                          <strong>
                            {workingSessions.length} {workingSessions.length === 1 ? "agent" : "agents"} working
                          </strong>{" "}
                          · {workingSessions.map((s) => s.state.title).join(", ")}
                        </span>
                        <span className={classes.spacer} />
                        {workingOpen ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
                      </button>
                      {workingOpen && (
                        <div className={classes.ambientExpanded}>
                          {workingSessions.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              className={classes.ambientRow}
                              onClick={() => setPreviewId(s.id)}
                            >
                              <div className={classes.ambientRowMain}>
                                <div className={classes.ambientRowTitle}>{s.state.title}</div>
                                <div className={classes.ambientRowSub}>{s.state.now}</div>
                              </div>
                              <span className={classes.when}>{s.host}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* 4. Sweep Banner */}
                {sweepCandidates.length > 0 && (
                  <section className={classes.section} aria-label="Sweep quiet sessions">
                    <div className={classes.sweepBanner}>
                      <Broom size={18} strokeWidth={1.9} aria-hidden />
                      <div className={classes.sweepBannerText}>
                        <div className={classes.sweepBannerTitle}>
                          {sweepCandidates.length} {sweepCandidates.length === 1 ? "session" : "sessions"} ready to sweep
                        </div>
                        <div className={classes.sweepBannerSub}>
                          {cleanSweepCount} clean &amp; safe to close
                          {cautionSweepCount > 0 ? ` · ${cautionSweepCount} with uncommitted changes` : ""}
                        </div>
                      </div>
                      <Button size="xs" radius="xl" variant="light" onClick={() => setSweepOpen(true)}>
                        Sweep
                      </Button>
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      <SweepModal
        opened={sweepOpen}
        onClose={() => setSweepOpen(false)}
        candidates={sweepCandidates}
        spaces={spaces}
        now={now}
        onArchiveDistill={handleArchiveDistill}
        onSnooze={handleSnoozeSession}
        onInspect={(s) => setPreviewId(s.id)}
      />

      <SessionPreviewModal
        session={previewSession}
        space={previewSession ? spaceById.get(resolveSpaceId(previewSession, spaces)) : undefined}
        now={now}
        onClose={() => setPreviewId(null)}
        onSendFollowUp={handleSendFollowUp}
        onSnooze={handleSnoozeSession}
        onArchiveDistill={handleArchiveDistill}
      />
    </div>
  );
}

/* ---- Subcomponents ---- */

function TurnCard({
  turn,
  space,
  session,
  now,
  replyOpen,
  replyDraft,
  onToggleReply,
  onReplyDraft,
  onAction,
  onInspect,
}: {
  turn: TurnItem;
  space: Space | undefined;
  session: BriefingSession | undefined;
  now: number;
  replyOpen: boolean;
  replyDraft: string;
  onToggleReply: () => void;
  onReplyDraft: (v: string) => void;
  onAction: (outcome: { label: string; reply?: string; resumeWorking?: boolean; snooze?: boolean }) => void;
  onInspect: () => void;
}) {
  const tone = turn.kind === "approval" ? "attention" : turn.kind === "blocked" ? "stalled" : "accent";
  return (
    <article className={classes.card} data-kind={turn.kind}>
      <div className={classes.cardMetaRow}>
        <span className={classes.spaceTag}>
          <ProjectSwatch project={space?.swatchKey ?? turn.spaceId} />
          {space?.name ?? turn.spaceId}
        </span>
        <span className={classes.pill} data-tone={tone}>
          <TurnIcon kind={turn.kind} />
          {TURN_LABEL[turn.kind]}
        </span>
        <span className={classes.when}>{formatAgo(turn.createdAt, now)}</span>
      </div>

      <h3 className={classes.cardTitle}>{turn.headline}</h3>
      <p className={classes.cardBody}>{turn.detail}</p>

      {turn.command && <pre className={classes.cmdBlock}>{turn.command}</pre>}

      {session && <FootprintChips footprint={session.footprint} branch={session.branch} host={session.host} />}

      <div className={classes.actionRow}>
        {turn.kind === "approval" && (
          <>
            <Button
              size="xs"
              color="blue"
              leftSection={<Check size={13} />}
              onClick={() => onAction({ label: "Approved command", resumeWorking: true })}
            >
              Allow
            </Button>
            <Button size="xs" variant="default" onClick={() => onAction({ label: "Denied command" })}>
              Deny
            </Button>
          </>
        )}

        {turn.kind === "question" && (
          <>
            {turn.options?.map((opt) => (
              <Button
                key={opt}
                size="xs"
                variant="light"
                onClick={() => onAction({ label: `Replied "${opt}"`, reply: opt, resumeWorking: true })}
              >
                {opt}
              </Button>
            ))}
            <Button size="xs" variant="subtle" onClick={onToggleReply}>
              {replyOpen ? "Cancel" : "Reply…"}
            </Button>
          </>
        )}

        {turn.kind === "ready_to_review" && (
          <>
            <Button size="xs" variant="light" leftSection={<ExternalLink size={13} />} onClick={onInspect}>
              Inspect
            </Button>
            <Button
              size="xs"
              variant="default"
              leftSection={<Check size={13} />}
              onClick={() => onAction({ label: "Marked ready item as done" })}
            >
              Mark done
            </Button>
          </>
        )}

        <Button
          size="xs"
          variant="subtle"
          leftSection={<Clock size={13} />}
          onClick={() => onAction({ label: "Snoozed for 1 day", snooze: true })}
        >
          Snooze 1d
        </Button>

        {turn.kind !== "ready_to_review" && (
          <Button size="xs" variant="subtle" onClick={onInspect}>
            Inspect
          </Button>
        )}
      </div>

      {replyOpen && (
        <div className={classes.replyRow}>
          <TextInput
            className={classes.replyInput}
            size="xs"
            placeholder="Write a reply…"
            aria-label="Reply to agent"
            value={replyDraft}
            onChange={(e) => onReplyDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && replyDraft.trim()) {
                onAction({ label: "Sent reply to agent", reply: replyDraft.trim(), resumeWorking: true });
              }
            }}
          />
          <Button
            size="xs"
            leftSection={<SendHorizontal size={13} />}
            disabled={!replyDraft.trim()}
            onClick={() => onAction({ label: "Sent reply to agent", reply: replyDraft.trim(), resumeWorking: true })}
          >
            Send
          </Button>
        </div>
      )}
    </article>
  );
}

function SpaceView({
  summary,
  now,
  editing,
  editGoal,
  editSummary,
  onEditGoal,
  onEditSummary,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onProposal,
  onOpenSession,
  onTurnAction,
  replyOpenId,
  replyDraft,
  onToggleReply,
  onReplyDraft,
}: {
  summary: SpaceSummary;
  now: number;
  editing: boolean;
  editGoal: string;
  editSummary: string;
  onEditGoal: (v: string) => void;
  onEditSummary: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onProposal: (spaceId: string, proposal: NotebookProposal, accept: boolean) => void;
  onOpenSession: (session: BriefingSession) => void;
  onTurnAction: (turn: TurnItem, outcome: { label: string; reply?: string; resumeWorking?: boolean; snooze?: boolean }) => void;
  replyOpenId: string | null;
  replyDraft: string;
  onToggleReply: (id: string) => void;
  onReplyDraft: (v: string) => void;
}) {
  const { space, sessions, openTurns } = summary;
  const activeSessions = sessions.filter((s) => s.status !== "archived" && !isSnoozed(s.snoozedUntil, now));
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  return (
    <>
      {/* Pinned Living Notebook */}
      <section className={classes.notebookCard} aria-label="Living notebook">
        <div className={classes.notebookHead}>
          <span className={classes.notebookEyebrow}>
            <BookOpen size={13} strokeWidth={2.4} aria-hidden />
            Living Notebook
          </span>
          <span className={classes.spacer} />
          {!editing && (
            <Button className={classes.notebookEditBtn} variant="subtle" size="xs" leftSection={<Pencil size={12} />} onClick={onStartEdit}>
              Edit
            </Button>
          )}
        </div>
        <div className={classes.notebookRuleRow}>
          <span className={classes.notebookRule}>Auto-routes: {formatRules(space.match)}</span>
        </div>

        {editing ? (
          <div className={classes.stack}>
            <TextInput label="Current goal" size="xs" value={editGoal} onChange={(e) => onEditGoal(e.currentTarget.value)} />
            <Textarea
              label="Current summary (shown on Project Radar)"
              size="xs"
              minRows={2}
              value={editSummary}
              onChange={(e) => onEditSummary(e.currentTarget.value)}
            />
            <div className={classes.actionRow}>
              <Button size="xs" onClick={onSaveEdit}>
                Save notebook
              </Button>
              <Button size="xs" variant="default" onClick={onCancelEdit}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className={classes.notebookGoal}>{space.notebook.goal}</p>
            <p className={classes.cardBody}>{space.notebook.summary}</p>
            {(space.notebook.knownFacts.length > 0 || space.notebook.blockers.length > 0) && (
              <div className={classes.notebookGrid}>
                {space.notebook.knownFacts.length > 0 && (
                  <div>
                    <h3 className={classes.notebookColTitle}>Established</h3>
                    <ul className={classes.bulletList}>
                      {space.notebook.knownFacts.map((fact, i) => (
                        <li key={i}>{fact}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {space.notebook.blockers.length > 0 && (
                  <div>
                    <h3 className={classes.notebookColTitle}>Open blockers</h3>
                    <ul className={classes.bulletList}>
                      {space.notebook.blockers.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Agent-proposed notebook updates (human-in-the-loop) */}
        {space.notebook.proposals.map((prop) => (
          <div key={prop.id} className={classes.proposalBox}>
            <div className={classes.proposalHead}>
              <Sparkles size={13} strokeWidth={2.2} aria-hidden />
              Proposed note from “{prop.fromTitle}”
            </div>
            <p className={classes.proposalText}>{prop.text}</p>
            <div className={classes.actionRow}>
              <Button size="xs" leftSection={<Check size={12} />} onClick={() => onProposal(space.id, prop, true)}>
                Add to notebook
              </Button>
              <Button size="xs" variant="subtle" onClick={() => onProposal(space.id, prop, false)}>
                Dismiss
              </Button>
            </div>
          </div>
        ))}
      </section>

      {/* Space-scoped Your Turn */}
      {openTurns.length > 0 && (
        <section className={classes.section} aria-label="Needs your input in this space">
          <div className={classes.sectionHead}>
            <h2 className={classes.sectionTitle} data-tone="attention">
              Your turn in {space.name}
              <span className={classes.sectionCount}>{openTurns.length}</span>
            </h2>
          </div>
          <div className={classes.stack}>
            {openTurns.map((turn) => (
              <TurnCard
                key={turn.id}
                turn={turn}
                space={space}
                session={sessionById.get(turn.sessionId)}
                now={now}
                replyOpen={replyOpenId === turn.id}
                replyDraft={replyDraft}
                onToggleReply={() => onToggleReply(turn.id)}
                onReplyDraft={onReplyDraft}
                onAction={(outcome) => onTurnAction(turn, outcome)}
                onInspect={() => {
                  const s = sessionById.get(turn.sessionId);
                  if (s) onOpenSession(s);
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* Active Threads (Quest-Log cards) */}
      <section className={classes.section} aria-label="Active threads">
        <div className={classes.sectionHead}>
          <h2 className={classes.sectionTitle}>
            Active threads
            <span className={classes.sectionCount}>{activeSessions.length}</span>
          </h2>
          <span className={classes.sectionHint}>Present state + live footprint</span>
        </div>

        {activeSessions.length === 0 ? (
          <div className={classes.card}>
            <EmptyState
              icon={<Sparkles size={20} strokeWidth={1.75} />}
              tone="gray"
              title="All clear in this Space"
              message="No active sessions right now. New sessions spawned here will automatically inherit the Living Notebook above."
            />
          </div>
        ) : (
          <div className={classes.stack}>
            {activeSessions.map((sess) => (
              <button
                key={sess.id}
                type="button"
                className={`${classes.card} ${classes.cardInteractive}`}
                onClick={() => onOpenSession(sess)}
              >
                <div className={classes.cardMetaRow}>
                  <span
                    className={classes.pill}
                    data-tone={
                      sess.status === "thinking"
                        ? "working"
                        : sess.state.stage === "blocked"
                          ? "stalled"
                          : sess.state.stage === "ready_to_review"
                            ? "attention"
                            : undefined
                    }
                  >
                    {sess.status === "thinking" ? "Working" : STAGE_LABEL[sess.state.stage]}
                  </span>
                  <span className={classes.spaceTag}>{sess.repo}</span>
                  <span className={classes.when}>{formatAgo(sess.lastActivityAt, now)}</span>
                </div>
                <h3 className={classes.cardTitle}>{sess.state.title}</h3>
                <p className={classes.cardBody}>{sess.state.now}</p>
                {sess.state.next && (
                  <div className={classes.nextLine}>
                    <span className={classes.nextLabel}>Next</span>
                    <span>{sess.state.next}</span>
                  </div>
                )}
                <FootprintChips footprint={sess.footprint} branch={sess.branch} host={sess.host} showClean />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Distilled Milestone Log */}
      {space.notebook.milestones.length > 0 && (
        <section className={classes.section} aria-label="Recent milestones">
          <div className={classes.sectionHead}>
            <h2 className={classes.sectionTitle}>
              Recent milestones
              <span className={classes.sectionCount}>{space.notebook.milestones.length}</span>
            </h2>
            <span className={classes.sectionHint}>Distilled from closed sessions</span>
          </div>
          <div className={classes.milestoneList}>
            {space.notebook.milestones.map((m) => (
              <div key={m.id} className={classes.milestoneRow}>
                <span className={classes.milestoneDate}>{SHORT_DATE.format(m.at)}</span>
                <span>{m.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
