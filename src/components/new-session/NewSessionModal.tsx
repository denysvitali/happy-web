import { Alert, Autocomplete, Button, Code, Collapse, Input, Loader, SegmentedControl, Select, Stack, Text, Textarea, UnstyledButton } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Info, MonitorOff, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { sessionsKey, type Account, type MachineItem, type SessionItem } from "@/lib/sync/account";
import { machineName } from "@/lib/sync/decode";
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

function NewSessionForm({ account, opts, onSpawned }: { account: Account; opts: NewSessionOptions; onSpawned: (id: string) => void }) {
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
      <Stack align="center" gap="xs" py="xl" ta="center">
        <MonitorOff size={32} strokeWidth={1.5} />
        <Text fw={600}>No computer is online</Text>
        <Text size="sm" c="dimmed">
          Start the Happy daemon on a computer or cluster (<Code>happy daemon start</Code>), then try again.
        </Text>
      </Stack>
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
        model,
        initialPrompt: prompt,
      });
      savePrefs({ mode, machineId: isK8s ? undefined : machine.id, agent, permissionMode: permission, repoKey: isK8s ? repo!.key : undefined, branch: isK8s ? branch.branch.trim() : undefined });
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
  let summary: ReactNode;
  if (isK8s) {
    summary = repo ? (
      <span>
        <strong>{AGENT_LONG[agent]}</strong> in a fresh workspace with <strong>{repoLabel(repo)}</strong>
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
        <strong>{AGENT_LONG[agent]}</strong> in <strong className={classes.mono}>{abbreviateHome(localDir, machine.meta.homeDir)}</strong> on <strong>{machineName(machine.meta, machine.id)}</strong>
      </span>
    ) : (
      <span>Pick a folder on {machineName(machine.meta, machine.id)}.</span>
    );
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="lg">
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
        <Input.Wrapper label="Agent">
          <SegmentedControl
            fullWidth
            mt={4}
            value={agent}
            onChange={(v) => setAgentByMode((a) => ({ ...a, [mode]: v }))}
            data={agents.map((a) => ({ value: a.value, label: AGENT_SHORT[a.value] ?? a.label }))}
          />
        </Input.Wrapper>
        <Textarea
          label="First message"
          description="Optional; sent as soon as the agent starts. Ctrl/⌘+Enter starts the session."
          placeholder={isK8s ? "e.g. Run the tests and fix what fails" : "What should the agent do?"}
          autosize
          minRows={2}
          maxRows={8}
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
          onKeyDown={submitOnModEnter}
        />
        <div>
          <UnstyledButton className={classes.toggle} data-expanded={advanced || undefined} aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
            <ChevronRight size={14} className={classes.chevron} />
            Advanced
            {!advanced && (permission !== defaultPermissionMode(agent) || model.trim()) && (
              <Text span size="xs" c="dimmed">
                · {[permission !== defaultPermissionMode(agent) && MODE_LABELS[permission], model.trim()].filter(Boolean).join(", ")}
              </Text>
            )}
          </UnstyledButton>
          <Collapse expanded={advanced}>
            <Stack gap="md" pt="md">
              <Select
                label="Permission mode"
                data={permModes.map((m) => ({ value: m, label: MODE_LABELS[m] ?? m }))}
                value={permission}
                onChange={(v) => v && setPermByAgent((p) => ({ ...p, [agent]: v }))}
                allowDeselect={false}
                comboboxProps={within}
              />
              <Autocomplete
                label="Model"
                placeholder="Account default"
                data={MODEL_SUGGESTIONS[agent] ?? []}
                value={model}
                onChange={setModel}
                autoComplete="off"
                spellCheck={false}
                comboboxProps={within}
              />
            </Stack>
          </Collapse>
        </div>
        <div className={classes.summary}>
          <Sparkles size={14} />
          {summary}
        </div>
        {error &&
          (missingBranch ? (
            <Alert color="yellow" icon={<Info size={16} />} title={`Branch “${missingBranch.ref}” doesn't exist`}>
              <Stack gap={8} align="flex-start">
                <span>
                  {missingBranch.repo} has no such branch
                  {missingBranch.defaultBranch ? `; its default branch is ${missingBranch.defaultBranch}.` : "."}
                </span>
                {missingBranch.defaultBranch && (
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
                )}
              </Stack>
            </Alert>
          ) : (
            <Alert color="red" title="Couldn't start the session">
              {error}
            </Alert>
          ))}
        <Stack gap={6}>
          <Button type="submit" size="md" disabled={!valid || busy} leftSection={busy ? <Loader size={16} color="currentColor" /> : undefined}>
            {busy ? (isK8s ? "Scheduling container…" : "Starting agent…") : isK8s ? "Start in Kubernetes" : "Start session"}
          </Button>
          {busy && isK8s && (
            <Text size="xs" c="dimmed" ta="center">
              {slow ? "Still going: cold image pulls and new volumes can take a few minutes." : "Creating the Pod and cloning the repository."}
            </Text>
          )}
        </Stack>
      </Stack>
    </form>
  );
}

export function openNewSession(account: Account, opts: NewSessionOptions, onSpawned: (id: string) => void) {
  const id = modals.open({
    title: (
      <Text fw={600} size="lg">
        New session
      </Text>
    ),
    size: "lg",
    padding: "lg",
    children: (
      <NewSessionForm
        account={account}
        opts={opts}
        onSpawned={(sid) => {
          modals.close(id);
          onSpawned(sid);
        }}
      />
    ),
  });
}
