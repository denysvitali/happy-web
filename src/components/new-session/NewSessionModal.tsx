import { Autocomplete, Button, Code, Kbd, Loader, SegmentedControl, Select, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { MonitorOff } from "lucide-react";
import { useEffect, useId, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useAccountSettingsOf } from "@/app/hooks";
import { sessionsKey, type Account, type MachineItem, type SessionItem } from "@/lib/sync/account";
import { machineName } from "@/lib/sync/decode";
import {
  agentKey,
  agentUsesProfiles,
  DEFAULT_PROVIDER_LABEL,
  EMPTY_SETTINGS,
  findProfile,
  gatewayModels,
  modelForProfile,
  NO_PROFILE,
  profileEndpoint,
  profilesForAgent,
  selectedProfileIdForAgent,
} from "@/lib/sync/profiles";
import {
  abbreviateHome,
  agentsFor,
  availableModes,
  backendRequestValue,
  cleanAdditionalRepos,
  clusterChoices,
  defaultLocalMachine,
  effectiveBranch,
  kubernetesCheckoutPath,
  machinesFor,
  MCP_SERVERS,
  mcpSelection,
  parseMissingBranchError,
  parseRepo,
  permissionModesFor,
  recentFolders,
  repoLabel,
  repoSuggestions,
  resolveHome,
  type SpawnBackend,
} from "@/lib/sync/spawn";
import { defaultPermissionMode } from "@/lib/sync/models";
import { KubernetesFields } from "./KubernetesFields";
import { LocalFields } from "./LocalFields";
import { ModePicker } from "./ModePicker";
import classes from "./new-session.module.css";
import { loadPrefs, savePrefs } from "./prefs";
import { useRepoBranches } from "./useRepoBranches";
import { Callout } from "@/ui/Callout";
import { Disclosure } from "@/ui/Disclosure";
import { EmptyState } from "@/ui/EmptyState";
import { FormRow, FormSection } from "@/ui/FormSection";
import { openSheet, SheetBody, SheetFooter } from "@/ui/Sheet";

const within = { withinPortal: false } as const;

const AGENT_SHORT: Record<string, string> = { claude: "Claude", codex: "Codex", opencode: "OpenCode", har: "Har" };
const AGENT_LONG: Record<string, string> = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode", har: "Har" };
const MODE_LABELS: Record<string, string> = {
  default: "Ask for permissions",
  acceptEdits: "Accept edits",
  plan: "Plan only",
  bypassPermissions: "Bypass permissions (yolo)",
  "read-only": "Read only",
  "safe-yolo": "Auto-approve, sandboxed",
  yolo: "Full access (yolo)",
};
const MODEL_SUGGESTIONS: Record<string, string[]> = { claude: ["opus", "sonnet", "haiku"] };

export interface NewSessionOptions {
  /** Online machines (callers filter with `isMachineOnline`). */
  machines: MachineItem[];
  /** Session list for history (recent folders, repos); defaults to the cached list. */
  sessions?: SessionItem[] | undefined;
  /** Preselect this machine (and the mode it supports). */
  machineId?: string | undefined;
}

function initialMode(modes: SpawnBackend[], hint: MachineItem | undefined, remembered: SpawnBackend | undefined): SpawnBackend {
  if (hint) return machinesFor([hint], "local").length ? "local" : "kubernetes";
  if (remembered && modes.includes(remembered)) return remembered;
  return modes.includes("local") ? "local" : (modes[0] ?? "local");
}

function NewSessionForm({ account, opts, onSpawned, onCancel }: { account: Account; opts: NewSessionOptions; onSpawned: (id: string) => void; onCancel: () => void }) {
  const uid = useId();
  const qc = useQueryClient();
  const { machines } = opts;
  const [prefs] = useState(loadPrefs);
  const [sessions] = useState(() => opts.sessions ?? qc.getQueryData<SessionItem[]>(sessionsKey) ?? []);
  const hint = machines.find((m) => m.id === opts.machineId);

  const modes = useMemo(() => availableModes(machines), [machines]);
  const locals = useMemo(() => machinesFor(machines, "local"), [machines]);
  const clusters = useMemo(() => clusterChoices(machines), [machines]);

  const [mode, setMode] = useState<SpawnBackend>(() => initialMode(modes, hint, prefs.mode));
  const [localId, setLocalId] = useState(() => defaultLocalMachine(locals, sessions, hint?.id ?? prefs.localMachineId)?.id);
  const [clusterId, setClusterId] = useState(() => (hint && clusters.includes(hint) ? hint.id : clusters[0]?.id));
  const machine = mode === "local" ? (locals.find((m) => m.id === localId) ?? locals[0]) : (clusters.find((m) => m.id === clusterId) ?? clusters[0]);

  // Local
  const [directory, setDirectory] = useState("");
  const folders = useMemo(() => (mode === "local" && machine ? recentFolders(sessions, machine.id) : []), [mode, machine, sessions]);

  // Kubernetes
  const [repoInput, setRepoInput] = useState("");
  const [branchTyped, setBranchTyped] = useState<string | null>(null);
  const [extraRepos, setExtraRepos] = useState<string[]>([]);
  const [extraRejected, setExtraRejected] = useState<string[]>([]);
  const [mcp, setMcp] = useState<string[]>([...MCP_SERVERS]);
  const repoOptions = useMemo(() => repoSuggestions(sessions), [sessions]);
  const repo = parseRepo(repoInput);
  const remembered = repo ? prefs.branches?.[repo.key] : undefined;
  const lookup = useRepoBranches(account, mode === "kubernetes" ? machine?.id : undefined, mode === "kubernetes" ? repo : null, branchTyped ?? remembered ?? "");
  const reply = lookup.reply?.ok ? lookup.reply : undefined;
  const branch = effectiveBranch({ typed: branchTyped, remembered, defaultBranch: reply?.defaultBranch, rememberedExists: branchTyped === null ? lookup.refExists : undefined });
  const checkoutPath = repo && machine ? kubernetesCheckoutPath(machine.meta, repo.url) : "";

  // Both
  const [agentByMode, setAgentByMode] = useState<Partial<Record<SpawnBackend, string>>>(() => ({ ...prefs.agent }));
  const agents = agentsFor(mode);
  const agent = agents.find((a) => a.value === agentByMode[mode])?.value ?? "claude";
  const [permByAgent, setPermByAgent] = useState<Record<string, string>>(() => ({ ...prefs.permissionMode }));
  const permModes = permissionModesFor(agent);
  const permission = permModes.includes(permByAgent[agent] ?? "") ? permByAgent[agent]! : defaultPermissionMode(agent);
  // Provider profile per agent: this browser's last pick, else the one the
  // Happy app remembers for the agent (account settings).
  const settingsQuery = useAccountSettingsOf(account);
  const settings = settingsQuery.data ?? EMPTY_SETTINGS;
  const [profileByAgent, setProfileByAgent] = useState<Record<string, string>>(() => ({ ...prefs.profile }));
  const usesProfiles = agentUsesProfiles(agent);
  const profileChoices = usesProfiles ? profilesForAgent(settings.profiles, agent) : [];
  const profileId = usesProfiles ? (selectedProfileIdForAgent(settings, agent, profileByAgent[agentKey(agent)]) ?? NO_PROFILE) : NO_PROFILE;
  const profile = findProfile(settings.profiles, profileId);
  const profileModel = modelForProfile({ profile, agent, favorites: settings.favoriteModelsByProfile });
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [advanced, setAdvanced] = useState(false);

  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setSlow(true), 15_000);
    return () => {
      clearTimeout(t);
      setSlow(false);
    };
  }, [busy]);

  if (!machine) {
    return (
      <>
        <SheetBody>
          <EmptyState
            tone="gray"
            icon={<MonitorOff size={24} strokeWidth={1.75} />}
            title="No computer is online"
            message={
              <>
                Start the Happy daemon on a computer or cluster (<Code>happy daemon start</Code>), then try again.
              </>
            }
          />
        </SheetBody>
        <SheetFooter>
          <Button variant="default" size="md" onClick={onCancel} data-autofocus>
            Close
          </Button>
        </SheetFooter>
      </>
    );
  }

  const isK8s = mode === "kubernetes";
  const localDir = resolveHome(directory, machine.meta.homeDir);
  const branchMissing = branchTyped !== null && lookup.refExists === false;
  const valid = isK8s ? !!repo && !!branch.branch.trim() && !branchMissing : !!localDir;
  const missingBranch = parseMissingBranchError(error);

  const changeMode = (m: SpawnBackend) => {
    setMode(m);
    setError("");
  };
  const changeRepo = (v: string) => {
    setRepoInput(v);
    setBranchTyped(null);
    setError("");
  };
  const changeExtra = (entries: string[]) => {
    const { repos, rejected } = cleanAdditionalRepos(entries, repoInput);
    setExtraRepos(repos);
    setExtraRejected(rejected);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const id = await account.spawn({
        machineId: machine.id,
        agent,
        backend: backendRequestValue(machine.meta, mode),
        directory: isK8s ? checkoutPath : localDir,
        repoUrl: isK8s ? repo!.url : undefined,
        repoRef: isK8s ? branch.branch : undefined,
        additionalRepos: isK8s ? extraRepos : undefined,
        mcpServers: isK8s ? mcpSelection(mcp) : undefined,
        permissionMode: permission,
        model: model.trim() || profileModel,
        profile,
        codexFastMode: settings.codexFastMode,
        initialPrompt: prompt,
      });
      savePrefs({ mode, machineId: isK8s ? undefined : machine.id, agent, permissionMode: permission, profile: usesProfiles ? profileId : undefined, repoKey: isK8s ? repo!.key : undefined, branch: isK8s ? branch.branch.trim() : undefined });
      notifications.show({ color: "green", message: "Session started" });
      onSpawned(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spawn failed");
    } finally {
      setBusy(false);
    }
  };

  const submitOnModEnter = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  // What will be created, in one quiet line.
  const via = profile ? (
    <>
      {" "}
      on <strong>{profile.name}</strong>
    </>
  ) : null;
  let summary: ReactNode;
  if (isK8s) {
    summary = repo ? (
      <span>
        <strong>{AGENT_LONG[agent]}</strong>
        {via} in a fresh workspace with <strong>{repoLabel(repo)}</strong>
        {branch.branch && (
          <>
            {" "}
            @ <strong>{branch.branch}</strong>
          </>
        )}
        {extraRepos.length > 0 && ` + ${extraRepos.length} more`} on {machineName(machine.meta, machine.id)}
      </span>
    ) : (
      <span>Pick a repository to clone into a fresh workspace on {machineName(machine.meta, machine.id)}.</span>
    );
  } else {
    summary = localDir ? (
      <span>
        <strong>{AGENT_LONG[agent]}</strong>
        {via} in <strong className={classes.mono}>{abbreviateHome(localDir, machine.meta.homeDir)}</strong> on <strong>{machineName(machine.meta, machine.id)}</strong>
      </span>
    ) : (
      <span>Pick a folder on {machineName(machine.meta, machine.id)}.</span>
    );
  }

  const advancedSummary = [profile?.name, permission !== defaultPermissionMode(agent) && MODE_LABELS[permission], model.trim()].filter(Boolean).join(", ");
  const progress = slow ? "Still going: cold image pulls and new volumes can take a few minutes." : "Creating the Pod and cloning the repository.";

  return (
    <form onSubmit={submit} className={classes.form}>
      <SheetBody>
        {modes.length > 1 && <ModePicker modes={modes} value={mode} onChange={changeMode} />}
        {isK8s ? (
          <KubernetesFields
            clusters={clusters}
            machine={machine}
            onCluster={setClusterId}
            repoInput={repoInput}
            onRepo={changeRepo}
            repo={repo}
            repoOptions={repoOptions}
            checkoutPath={checkoutPath}
            lookup={lookup}
            branch={{ value: branch.branch, typed: branchTyped !== null, substituted: branch.substituted }}
            onBranch={(v) => {
              setBranchTyped(v);
              setError("");
            }}
            extraRepos={extraRepos}
            onExtraRepos={changeExtra}
            extraRejected={extraRejected}
            mcp={mcp}
            onMcp={setMcp}
          />
        ) : (
          <LocalFields machines={locals} machine={machine} onMachine={setLocalId} folders={folders} directory={directory} onDirectory={setDirectory} />
        )}
        <FormSection title="Agent">
          <FormRow layout="bare">
            <div className={classes.segmentRow}>
              <SegmentedControl
                fullWidth
                aria-label="Agent"
                value={agent}
                onChange={(v) => setAgentByMode((a) => ({ ...a, [mode]: v }))}
                data={agents.map((a) => ({ value: a.value, label: AGENT_SHORT[a.value] ?? a.label }))}
              />
            </div>
          </FormRow>
        </FormSection>
        <FormSection
          title={<label htmlFor={`${uid}-prompt`}>First message</label>}
          footer={
            <span id={`${uid}-prompt-hint`}>
              Optional; sent as soon as the agent starts. <Kbd size="xs">Ctrl/⌘</Kbd> <Kbd size="xs">Enter</Kbd> starts the session.
            </span>
          }
        >
          <FormRow layout="bare">
            <Textarea
              id={`${uid}-prompt`}
              aria-describedby={`${uid}-prompt-hint`}
              variant="unstyled"
              classNames={{ input: classes.message }}
              placeholder={isK8s ? "e.g. Run the tests and fix what fails" : "What should the agent do?"}
              autosize
              minRows={3}
              maxRows={10}
              value={prompt}
              onChange={(e) => setPrompt(e.currentTarget.value)}
              onKeyDown={submitOnModEnter}
            />
          </FormRow>
        </FormSection>
        <Disclosure
          open={advanced}
          onToggle={() => setAdvanced((a) => !a)}
          header={
            <>
              Advanced
              {!advanced && advancedSummary && <span className={classes.advancedSummary}>· {advancedSummary}</span>}
            </>
          }
        >
          <div className={classes.advanced}>
            <FormSection
              footer={
                usesProfiles &&
                (settingsQuery.isError
                  ? "Your profiles from the Happy app couldn't be loaded; built-ins only."
                  : profile
                    ? `${profile.name} routes ${AGENT_SHORT[agent]} to ${profileEndpoint(profile) ?? "its account login"}.`
                    : `${AGENT_SHORT[agent]} uses its own account login.`)
              }
            >
              {usesProfiles && (
                <FormRow label="Provider" labelFor={`${uid}-provider`}>
                  <Select
                    id={`${uid}-provider`}
                    data={[{ value: NO_PROFILE, label: `${DEFAULT_PROVIDER_LABEL} (account login)` }, ...profileChoices.map((p) => ({ value: p.id, label: p.name }))]}
                    value={profileId}
                    onChange={(v) => {
                      if (!v) return;
                      setProfileByAgent((m) => ({ ...m, [agentKey(agent)]: v }));
                      setModel("");
                      setError("");
                    }}
                    allowDeselect={false}
                    searchable={profileChoices.length > 8}
                    comboboxProps={within}
                  />
                </FormRow>
              )}
              <FormRow label="Model" labelFor={`${uid}-model`}>
                <Autocomplete
                  id={`${uid}-model`}
                  placeholder={profileModel === "default" ? (profile ? "Provider default" : "Account default") : profileModel}
                  data={gatewayModels(profile) ?? (profile ? [] : (MODEL_SUGGESTIONS[agent] ?? []))}
                  value={model}
                  onChange={setModel}
                  autoComplete="off"
                  spellCheck={false}
                  comboboxProps={within}
                />
              </FormRow>
              <FormRow label="Permission mode" labelFor={`${uid}-perm`}>
                <Select
                  id={`${uid}-perm`}
                  data={permModes.map((m) => ({ value: m, label: MODE_LABELS[m] ?? m }))}
                  value={permission}
                  onChange={(v) => v && setPermByAgent((p) => ({ ...p, [agent]: v }))}
                  allowDeselect={false}
                  comboboxProps={within}
                />
              </FormRow>
            </FormSection>
          </div>
        </Disclosure>
        {error &&
          (missingBranch ? (
            <Callout
              tone="warning"
              title={`Branch “${missingBranch.ref}” doesn't exist`}
              action={
                missingBranch.defaultBranch && (
                  <Button
                    size="xs"
                    variant="light"
                    color="yellow"
                    onClick={() => {
                      setBranchTyped(missingBranch.defaultBranch!);
                      setError("");
                    }}
                  >
                    Use {missingBranch.defaultBranch}
                  </Button>
                )
              }
            >
              {missingBranch.repo} has no such branch
              {missingBranch.defaultBranch ? `; its default branch is ${missingBranch.defaultBranch}.` : "."}
            </Callout>
          ) : (
            <Callout tone="danger" title="Couldn't start the session">
              {error}
            </Callout>
          ))}
      </SheetBody>
      <SheetFooter note={<div className={classes.summary} aria-live="polite">{busy && isK8s ? progress : summary}</div>}>
        <Button variant="default" size="md" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="md" disabled={!valid || busy} leftSection={busy ? <Loader size={16} color="currentColor" /> : undefined}>
          {busy ? (isK8s ? "Scheduling container…" : "Starting agent…") : isK8s ? "Start in Kubernetes" : "Start session"}
        </Button>
      </SheetFooter>
    </form>
  );
}

export function openNewSession(account: Account, opts: NewSessionOptions, onSpawned: (id: string) => void) {
  openSheet({
    title: "New session",
    size: 580,
    children: (close) => (
      <NewSessionForm
        account={account}
        opts={opts}
        onCancel={close}
        onSpawned={(sid) => {
          close();
          onSpawned(sid);
        }}
      />
    ),
  });
}
