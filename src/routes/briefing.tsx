// /briefing: stripped-down comparison of two calm session-overview shapes:
//   1. "List" — all active sessions grouped by project, 2 plain lines each.
//   2. "Projects" — 1-line rolled-up status per project; tap to drill in.
// Actions live strictly inside the session detail pane, never on the overview.
import { Button, SegmentedControl, Tooltip } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, ChevronDown, ChevronRight, LayoutList, RotateCcw, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createSimpleDemo, type SimpleDataset } from "@/components/briefing/mockData";
import { filterSessions, summarizeProjects, type SimpleProject, type SimpleSession } from "@/components/briefing/model";
import { formatAgo } from "@/lib/sync/sessionList";
import { IconButton } from "@/ui/IconButton";
import { SearchField } from "@/ui/SearchField";
import { showUndo } from "@/ui/undoToast";
import classes from "@/components/briefing/briefing.module.css";

type Mode = "list" | "projects";

export function BriefingScreen() {
  const [data, setData] = useState<SimpleDataset>(() => createSimpleDemo());
  const [mode, setMode] = useState<Mode>("list");
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { now, projects, sessions } = data;
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const summaries = useMemo(() => summarizeProjects(projects, sessions), [projects, sessions]);
  const activeProjects = useMemo(() => summaries.filter((s) => s.active.length > 0), [summaries]);
  const quietProjects = useMemo(() => summaries.filter((s) => s.active.length === 0), [summaries]);
  const allOlder = useMemo(() => sessions.filter((s) => s.older || s.resolved), [sessions]);

  const openProject = openProjectId ? summaries.find((s) => s.project.id === openProjectId) : undefined;
  const selectedSession = selectedSessionId ? sessions.find((s) => s.id === selectedSessionId) : undefined;
  const searchHits = useMemo(() => (searchOpen && query.trim() ? filterSessions(sessions, projects, query) : []), [searchOpen, query, sessions, projects]);

  const mutateSession = (id: string, patch: (s: SimpleSession) => SimpleSession, undoLabel: string) => {
    let prevData: SimpleDataset | null = null;
    setData((prev) => {
      prevData = prev;
      return { ...prev, sessions: prev.sessions.map((s) => (s.id === id ? patch(s) : s)) };
    });
    showUndo(undoLabel, () => {
      if (prevData) setData(prevData);
    });
  };

  const resolvePending = (session: SimpleSession, statusLine: string, dot: SimpleSession["dot"], undoLabel: string) => {
    mutateSession(
      session.id,
      (s) => ({ ...s, dot, statusLine, updatedAt: now, pending: undefined }),
      undoLabel,
    );
  };

  const archiveSession = (session: SimpleSession) => {
    mutateSession(session.id, (s) => ({ ...s, resolved: true, pending: undefined }), `Archived "${session.title}"`);
    setSelectedSessionId(null);
  };

  const reset = () => {
    setData(createSimpleDemo());
    setOpenProjectId(null);
    setSelectedSessionId(null);
    setShowOlder(false);
    setSearchOpen(false);
    setQuery("");
  };

  const heading = mode === "projects" && openProject ? openProject.project.name : mode === "projects" ? "Projects" : "Sessions";

  return (
    <div className={classes.page} data-detail={selectedSession ? true : undefined}>
      {/* Left / Primary List Pane */}
      <section className={classes.listPane} aria-label="Overview">
        <header className={classes.bar}>
          {mode === "projects" && openProject && (
            <IconButton label="All projects" icon={<ArrowLeft size={18} />} onClick={() => setOpenProjectId(null)} />
          )}
          <h1 className={classes.barTitle}>{heading}</h1>
          <div className={classes.spacer} />
          <Tooltip label="Search" openDelay={300}>
            <IconButton
              label="Search"
              icon={searchOpen ? <X size={17} /> : <Search size={17} />}
              onClick={() => {
                setSearchOpen((v) => !v);
                if (searchOpen) setQuery("");
              }}
            />
          </Tooltip>
          <Tooltip label="Reset sample" openDelay={300}>
            <IconButton label="Reset sample" icon={<RotateCcw size={16} />} onClick={reset} />
          </Tooltip>
          <Tooltip label="Classic sessions view" openDelay={300}>
            <Link to="/" className={classes.barLink} aria-label="Classic sessions view">
              <LayoutList size={17} strokeWidth={1.9} aria-hidden />
            </Link>
          </Tooltip>
        </header>

        {/* Simple prototype switcher: Option 1 (List) vs Option 2 (Projects) */}
        <div className={classes.modeBar}>
          <SegmentedControl
            fullWidth
            size="xs"
            aria-label="Overview style"
            value={mode}
            onChange={(v) => {
              setMode(v as Mode);
              setOpenProjectId(null);
            }}
            data={[
              { value: "list", label: "Option 1 · List" },
              { value: "projects", label: "Option 2 · Projects" },
            ]}
          />
        </div>

        {searchOpen && (
          <div className={classes.searchBar}>
            <SearchField value={query} onChange={setQuery} placeholder="Search sessions or projects…" label="Search" />
          </div>
        )}

        <div className={classes.scroll}>
          {searchOpen && query.trim() ? (
            <div className={classes.group}>
              <h2 className={classes.groupLabel}>Results · {searchHits.length}</h2>
              {searchHits.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  now={now}
                  selected={selectedSessionId === s.id}
                  prefix={projectById.get(s.projectId)?.name}
                  onClick={() => setSelectedSessionId(s.id)}
                />
              ))}
            </div>
          ) : mode === "list" ? (
            /* ---- OPTION 1: Plain-English Status List ---- */
            <>
              {activeProjects.map((g) => (
                <div key={g.project.id} className={classes.group}>
                  <h2 className={classes.groupLabel}>{g.project.name}</h2>
                  {g.active.map((s) => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      now={now}
                      selected={selectedSessionId === s.id}
                      onClick={() => setSelectedSessionId(s.id)}
                    />
                  ))}
                </div>
              ))}

              {allOlder.length > 0 && (
                <>
                  <button type="button" className={classes.olderToggle} aria-expanded={showOlder} onClick={() => setShowOlder((v) => !v)}>
                    <span>{allOlder.length} older sessions</span>
                    {showOlder ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
                  </button>
                  {showOlder &&
                    allOlder.map((s) => (
                      <div key={s.id} className={classes.olderRow}>
                        <SessionRow
                          session={s}
                          now={now}
                          selected={selectedSessionId === s.id}
                          prefix={projectById.get(s.projectId)?.name}
                          onClick={() => setSelectedSessionId(s.id)}
                        />
                      </div>
                    ))}
                </>
              )}
            </>
          ) : openProject ? (
            /* ---- OPTION 2 (Level 2): Inside a single project ---- */
            <>
              <p className={classes.projectLede}>{openProject.project.summary}</p>
              {openProject.active.length > 0 && (
                <div className={classes.group}>
                  {openProject.active.map((s) => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      now={now}
                      selected={selectedSessionId === s.id}
                      onClick={() => setSelectedSessionId(s.id)}
                    />
                  ))}
                </div>
              )}
              {openProject.older.length > 0 && (
                <div className={classes.group}>
                  <h2 className={classes.groupLabel}>Older</h2>
                  {openProject.older.map((s) => (
                    <div key={s.id} className={classes.olderRow}>
                      <SessionRow
                        session={s}
                        now={now}
                        selected={selectedSessionId === s.id}
                        onClick={() => setSelectedSessionId(s.id)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            /* ---- OPTION 2 (Level 1): Projects First ---- */
            <>
              <div className={classes.group}>
                {activeProjects.map((g) => (
                  <button key={g.project.id} type="button" className={classes.row} onClick={() => setOpenProjectId(g.project.id)}>
                    <span className={classes.dot} data-dot={g.dot} aria-hidden />
                    <span className={classes.rowMain}>
                      <span className={classes.rowTop}>
                        <span className={classes.rowTitle}>{g.project.name}</span>
                        <span className={classes.rowWhen}>{formatAgo(g.latestAt, now)}</span>
                      </span>
                      <span className={classes.rowSub}>{g.project.summary}</span>
                    </span>
                    <ChevronRight size={16} className={classes.chevron} aria-hidden />
                  </button>
                ))}
              </div>

              {quietProjects.length > 0 && (
                <>
                  <button type="button" className={classes.olderToggle} aria-expanded={showOlder} onClick={() => setShowOlder((v) => !v)}>
                    <span>
                      {quietProjects.length} quiet {quietProjects.length === 1 ? "project" : "projects"}
                    </span>
                    {showOlder ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
                  </button>
                  {showOlder &&
                    quietProjects.map((g) => (
                      <button
                        key={g.project.id}
                        type="button"
                        className={`${classes.row} ${classes.olderRow}`}
                        onClick={() => setOpenProjectId(g.project.id)}
                      >
                        <span className={classes.dot} data-dot="paused" aria-hidden />
                        <span className={classes.rowMain}>
                          <span className={classes.rowTop}>
                            <span className={classes.rowTitle}>{g.project.name}</span>
                          </span>
                          <span className={classes.rowSub}>{g.project.summary}</span>
                        </span>
                        <ChevronRight size={16} className={classes.chevron} aria-hidden />
                      </button>
                    ))}
                </>
              )}
            </>
          )}
        </div>
      </section>

      {/* Right / Detail Pane — actions live here, keeping the overview spotless */}
      <main className={classes.detailPane} aria-label="Session detail">
        {selectedSession ? (
          <>
            <header className={classes.bar}>
              <span className={classes.mobileOnly}>
                <IconButton label="Back" icon={<ArrowLeft size={18} />} onClick={() => setSelectedSessionId(null)} />
              </span>
              <h2 className={classes.barTitle}>{selectedSession.title}</h2>
            </header>
            <div className={classes.detailBody}>
              <SessionDetail
                session={selectedSession}
                project={projectById.get(selectedSession.projectId)}
                now={now}
                onResolve={resolvePending}
                onArchive={archiveSession}
              />
            </div>
          </>
        ) : (
          <div className={classes.detailEmpty}>Select a session to open its transcript and actions.</div>
        )}
      </main>
    </div>
  );
}

function SessionRow({
  session,
  now,
  selected,
  prefix,
  onClick,
}: {
  session: SimpleSession;
  now: number;
  selected: boolean;
  prefix?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={classes.row} data-selected={selected || undefined} onClick={onClick}>
      <span className={classes.dot} data-dot={session.dot} aria-hidden />
      <span className={classes.rowMain}>
        <span className={classes.rowTop}>
          <span className={classes.rowTitle}>{session.title}</span>
          <span className={classes.rowWhen}>{formatAgo(session.updatedAt, now)}</span>
        </span>
        <span className={classes.rowSub}>
          {prefix ? `${prefix} · ` : ""}
          {session.statusLine}
        </span>
      </span>
    </button>
  );
}

function SessionDetail({
  session,
  project,
  now,
  onResolve,
  onArchive,
}: {
  session: SimpleSession;
  project: SimpleProject | undefined;
  now: number;
  onResolve: (s: SimpleSession, statusLine: string, dot: SimpleSession["dot"], undoLabel: string) => void;
  onArchive: (s: SimpleSession) => void;
}) {
  const p = session.pending;
  return (
    <div className={classes.detailInner}>
      <div className={classes.detailHeader}>
        <span className={classes.detailEyebrow}>
          {project?.name} · updated {formatAgo(session.updatedAt, now)} ago
        </span>
        <h3 className={classes.detailTitle}>{session.title}</h3>
        <p className={classes.detailStatus}>{session.statusLine}</p>
        <div className={classes.detailMeta}>
          {[session.repo, session.branch, session.host, session.dirtySummary].filter(Boolean).join(" · ")}
        </div>
      </div>

      {p && (
        <div className={classes.actionCard}>
          <p className={classes.actionPrompt}>{p.prompt}</p>
          {p.command && <pre className={classes.cmd}>{p.command}</pre>}
          <div className={classes.actions}>
            {p.kind === "approval" && (
              <>
                <Button
                  size="xs"
                  leftSection={<Check size={14} />}
                  onClick={() => onResolve(session, "Approved — reloading hi6250-drm & running kmscube", "working", "Approved command")}
                >
                  Allow
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  onClick={() => onResolve(session, "Command denied — paused", "paused", "Denied command")}
                >
                  Deny
                </Button>
              </>
            )}
            {p.kind === "question" &&
              p.options?.map((opt) => (
                <Button
                  key={opt}
                  size="xs"
                  variant="light"
                  onClick={() => onResolve(session, `Generating codecs (${opt})`, "working", `Replied "${opt}"`)}
                >
                  {opt}
                </Button>
              ))}
            {p.kind === "review" && (
              <Button
                size="xs"
                leftSection={<Check size={14} />}
                onClick={() => onResolve(session, "Reviewed and ready to commit", "paused", "Marked reviewed")}
              >
                Looks good
              </Button>
            )}
          </div>
        </div>
      )}

      {!session.older && !session.resolved && (
        <div className={classes.actions}>
          <Button size="xs" variant="subtle" onClick={() => onArchive(session)}>
            Archive session
          </Button>
        </div>
      )}
    </div>
  );
}
