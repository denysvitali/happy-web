import {
  Modal,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Keyboard,
  LayoutGrid,
  LogOut,
  Monitor,
  Pencil,
  Plus,
  Search,
  SearchX,
  Settings,
  Square,
  SunMoon,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useSessionActions } from "@/components/sessions/actions";
import { AgentAvatar } from "@/components/status";
import type { MachineItem } from "@/lib/sync/account";
import { machineName } from "@/lib/sync/decode";
import {
  agentLabel,
  isLiveSession,
  metaLine,
  type SessionView,
} from "@/lib/sync/sessionList";
import { rank, scoreFields, tokenize, type Field, type Rankable } from "./rank";
import classes from "./palette.module.css";

export interface PaletteProps {
  opened: boolean;
  onClose: () => void;
  views: SessionView[];
  activeId: string | undefined;
  /** Online machines. */
  machines: MachineItem[];
  onOpenSession: (id: string) => void;
  onNewSession: (machineId?: string) => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onDemo: () => void;
  onForget: () => void;
}

type GroupKey = "current" | "recent" | "sessions" | "actions";
const GROUP_LABEL: Record<GroupKey, string> = {
  current: "This session",
  recent: "Recent",
  sessions: "Sessions",
  actions: "Actions",
};

interface Item extends Rankable {
  id: string;
  title: string;
  subtitle?: string;
  leading: ReactNode;
  trailing?: ReactNode;
  run: () => void;
}

interface Group {
  key: GroupKey;
  items: Item[];
}

const tile = (Icon: LucideIcon, tone?: "danger") => (
  <span className={classes.tile} data-tone={tone}>
    <Icon size={15} strokeWidth={2} aria-hidden />
  </span>
);

const hint = (k: string) => <kbd className={classes.key}>{k}</kbd>;

function sessionItem(v: SessionView, run: () => void): Item {
  const m = v.item.meta;
  const w = v.group === "archived" ? 0.8 : 1;
  const fields: Field[] = [
    { text: v.title, weight: w },
    { text: v.project, weight: 0.7 * w },
    { text: v.machine, weight: 0.6 * w },
    { text: agentLabel(v.agent), weight: 0.6 * w },
    { text: m.path ?? "", weight: 0.5 * w },
    { text: m.gitBranch ?? "", weight: 0.4 * w },
    { text: v.id, weight: 0.3 * w },
  ];
  return {
    id: `s-${v.id}`,
    title: v.title,
    subtitle: metaLine(v),
    leading: (
      <AgentAvatar
        agent={v.agent}
        status={v.status}
        attention={v.pending > 0}
        size={28}
      />
    ),
    trailing: <span className={classes.ago}>{v.ago}</span>,
    fields,
    recency: v.lastActivity,
    run,
  };
}

function action(
  id: string,
  title: string,
  icon: ReactNode,
  run: () => void,
  extra: { keywords?: string; trailing?: ReactNode } = {},
): Item {
  return {
    id,
    title,
    leading: icon,
    trailing: extra.trailing,
    fields: [
      { text: title, weight: 1 },
      { text: extra.keywords ?? "", weight: 0.5 },
    ],
    run,
  };
}

/** Command palette: sessions and actions behind one fuzzy field (Cmd/Ctrl+K). */
export default function Palette(props: PaletteProps) {
  // Actions that open other dialogs wait for this one to finish closing, so focus is not fought over.
  const after = useRef<(() => void) | null>(null);
  const onClose = useRef(props.onClose);
  useEffect(() => {
    onClose.current = props.onClose;
  });
  const flush = useCallback(() => {
    const f = after.current;
    after.current = null;
    f?.();
  }, []);
  const choose = useCallback(
    (run: () => void) => {
      after.current = run;
      onClose.current();
      setTimeout(flush, 450); // fallback if the exit transition never reports
    },
    [flush],
  );
  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      onExitTransitionEnd={flush}
      title="Command palette"
      withCloseButton={false}
      lockScroll={false}
      centered={false}
      yOffset="12vh"
      size={640}
      padding={0}
      transitionProps={{ transition: "pop", duration: 140, exitDuration: 90 }}
      classNames={{
        overlay: classes.overlay,
        inner: classes.inner,
        content: classes.content,
        header: classes.srHeader,
        body: classes.body,
      }}
    >
      <Body {...props} choose={choose} />
    </Modal>
  );
}

function Body({
  views,
  activeId,
  machines,
  onOpenSession,
  onNewSession,
  onSettings,
  onShortcuts,
  onDemo,
  onForget,
  choose,
}: PaletteProps & { choose: (run: () => void) => void }) {
  const actions = useSessionActions();
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("light");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const current = useMemo(
    () => views.find((v) => v.id === activeId),
    [views, activeId],
  );

  const sessionItems = useMemo(
    () =>
      views.map((v) => sessionItem(v, () => choose(() => onOpenSession(v.id)))),
    [views, choose, onOpenSession],
  );

  const { currentItems, actionItems } = useMemo(() => {
    const currentItems: Item[] = [];
    if (current) {
      const s = current.item;
      const live = isLiveSession(s);
      if (!s.undecryptable)
        currentItems.push(
          action(
            "c-rename",
            "Rename session",
            tile(Pencil),
            () => choose(() => actions.rename(s)),
            { keywords: "title name" },
          ),
        );
      if (s.archived)
        currentItems.push(
          action("c-unarchive", "Unarchive session", tile(ArchiveRestore), () =>
            choose(() => actions.unarchive(s)),
          ),
        );
      else {
        if (live)
          currentItems.push(
            action(
              "c-stop",
              "Stop session",
              tile(Square, "danger"),
              () => choose(() => actions.stop(s)),
              { keywords: "kill end" },
            ),
          );
        currentItems.push(
          action(
            "c-archive",
            live ? "Stop and archive" : "Archive session",
            tile(Archive, live ? "danger" : undefined),
            () => choose(() => actions.archive(s)),
            { keywords: "stop close" },
          ),
        );
      }
      currentItems.push(
        action(
          "c-copy",
          "Copy session ID",
          tile(Copy),
          () => choose(() => actions.copyId(s)),
          { keywords: "clipboard uuid" },
        ),
      );
    }
    const actionItems: Item[] = [];
    if (machines.length === 1)
      actionItems.push(
        action(
          "a-new",
          "New session",
          tile(Plus),
          () => choose(() => onNewSession()),
          { keywords: "create start spawn", trailing: hint("N") },
        ),
      );
    else if (machines.length > 1) {
      actionItems.push(
        action(
          "a-new",
          "New session",
          tile(Plus),
          () => choose(() => onNewSession()),
          { keywords: "create start spawn", trailing: hint("N") },
        ),
      );
      for (const m of machines) {
        const name = machineName(m.meta, m.id);
        actionItems.push(
          action(
            `a-new-${m.id}`,
            `New session on ${name}`,
            tile(Monitor),
            () => choose(() => onNewSession(m.id)),
            { keywords: "create start spawn machine" },
          ),
        );
      }
    }
    actionItems.push(
      action(
        "a-theme",
        scheme === "dark" ? "Switch to light mode" : "Switch to dark mode",
        tile(SunMoon),
        () =>
          choose(() => setColorScheme(scheme === "dark" ? "light" : "dark")),
        { keywords: "toggle theme appearance light dark" },
      ),
      action(
        "a-settings",
        "Account and settings",
        tile(Settings),
        () => choose(onSettings),
        { keywords: "preferences server machines account" },
      ),
      action(
        "a-shortcuts",
        "Keyboard shortcuts",
        tile(Keyboard),
        () => choose(onShortcuts),
        { keywords: "keys help cheat sheet", trailing: hint("?") },
      ),
      action(
        "a-demo",
        "Components demo",
        tile(LayoutGrid),
        () => choose(onDemo),
        { keywords: "design system ui" },
      ),
      action(
        "a-forget",
        "Forget this device",
        tile(LogOut, "danger"),
        () => choose(onForget),
        { keywords: "sign out log out unlink remove" },
      ),
    );
    return { currentItems, actionItems };
  }, [
    current,
    machines,
    scheme,
    actions,
    choose,
    onNewSession,
    onSettings,
    onShortcuts,
    onDemo,
    onForget,
    setColorScheme,
  ]);

  const q = query.trim();
  const groups = useMemo<Group[]>(() => {
    let g: Group[];
    if (!q) {
      const recent = sessionItems
        .filter((_, i) => views[i]!.group !== "archived")
        .sort((a, b) => (b.recency ?? 0) - (a.recency ?? 0))
        .slice(0, 5);
      g = [
        { key: "current", items: currentItems },
        { key: "recent", items: recent },
        { key: "actions", items: actionItems },
      ];
    } else {
      g = [
        { key: "current", items: rank(currentItems, q) },
        { key: "sessions", items: rank(sessionItems, q, 8) },
        { key: "actions", items: rank(actionItems, q, 8) },
      ];
      // The group holding the best match leads.
      const tokens = tokenize(q);
      const best = (x: Group) =>
        x.items[0] ? scoreFields(tokens, x.items[0].fields) : 0;
      g.sort((a, b) => best(b) - best(a));
    }
    return g.filter((x) => x.items.length > 0);
  }, [q, sessionItems, currentItems, actionItems, views]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const index = Math.min(active, Math.max(0, flat.length - 1));
  const activeItem = flat[index];
  const optId = (it: Item) => `palette-opt-${it.id}`;

  useEffect(() => {
    if (!activeItem) return;
    document
      .getElementById(optId(activeItem))
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeItem]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length === 0) return;
      setActive(
        (index + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      activeItem?.run();
    }
  };

  return (
    <div className={classes.panel}>
      <div className={classes.field}>
        <Search
          size={18}
          strokeWidth={2}
          aria-hidden
          className={classes.fieldIcon}
        />
        <input
          className={classes.input}
          data-autofocus
          type="text"
          role="combobox"
          aria-label="Search sessions and actions"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-autocomplete="list"
          aria-activedescendant={activeItem ? optId(activeItem) : undefined}
          placeholder="Search sessions and actions"
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {hint("esc")}
      </div>
      <div
        ref={listRef}
        id="palette-list"
        role="listbox"
        aria-label="Results"
        className={classes.list}
      >
        {groups.map((g) => (
          <div
            key={g.key}
            role="group"
            aria-labelledby={`palette-g-${g.key}`}
            className={classes.group}
          >
            <div id={`palette-g-${g.key}`} className={classes.groupLabel}>
              {GROUP_LABEL[g.key]}
            </div>
            {g.items.map((it) => (
              <div
                key={it.id}
                id={optId(it)}
                role="option"
                aria-selected={it === activeItem}
                data-active={it === activeItem || undefined}
                className={classes.option}
                onMouseMove={() => setActive(flat.indexOf(it))}
                onClick={it.run}
              >
                {it.leading}
                <span className={classes.text}>
                  <span className={classes.title}>{it.title}</span>
                  {it.subtitle && (
                    <span className={classes.subtitle}>{it.subtitle}</span>
                  )}
                </span>
                {it.trailing}
              </div>
            ))}
          </div>
        ))}
        {flat.length === 0 && (
          <div className={classes.empty}>
            <SearchX size={22} strokeWidth={1.75} aria-hidden />
            <div className={classes.emptyTitle}>No results for “{q}”</div>
            <div>Try a session title, folder, machine or agent name.</div>
          </div>
        )}
      </div>
      <div className={classes.sr} role="status">
        {q ? `${flat.length} result${flat.length === 1 ? "" : "s"}` : ""}
      </div>
      <div className={classes.footer} aria-hidden>
        <span>
          {hint("↑")}
          {hint("↓")} navigate
        </span>
        <span>{hint("↵")} select</span>
        <span>{hint("esc")} close</span>
      </div>
    </div>
  );
}
