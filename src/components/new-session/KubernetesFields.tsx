import { Anchor, Autocomplete, Loader, Select, Switch, TagsInput, type OptionsFilter } from "@mantine/core";
import { Activity, FolderGit2, GitBranch, ScrollText, Server, Workflow } from "lucide-react";
import { useId, useMemo, type ReactNode } from "react";
import type { MachineItem } from "@/lib/sync/account";
import { machineName } from "@/lib/sync/decode";
import { MAX_ADDITIONAL_REPOS, MCP_SERVERS, repoLabel, type RepoRef } from "@/lib/sync/spawn";
import { FormRow, FormSection } from "@/ui/FormSection";
import classes from "./new-session.module.css";
import type { BranchLookup } from "./useRepoBranches";

const within = { withinPortal: false } as const;

const MCP: Record<(typeof MCP_SERVERS)[number], { label: string; icon: typeof Workflow; tone: string }> = {
  "github-actions": { label: "GitHub Actions", icon: Workflow, tone: "gray" },
  loki: { label: "Loki logs", icon: ScrollText, tone: "orange" },
  prometheus: { label: "Prometheus metrics", icon: Activity, tone: "red" },
};

export interface BranchState {
  value: string;
  /** The user typed it (vs. remembered / default). */
  typed: boolean;
  /** A remembered branch that no longer exists and was replaced. */
  substituted?: string | undefined;
}

export function KubernetesFields(p: {
  clusters: MachineItem[];
  machine: MachineItem;
  onCluster: (id: string) => void;
  repoInput: string;
  onRepo: (v: string) => void;
  repo: RepoRef | null;
  repoOptions: string[];
  checkoutPath: string;
  lookup: BranchLookup;
  branch: BranchState;
  onBranch: (v: string) => void;
  extraRepos: string[];
  onExtraRepos: (v: string[]) => void;
  extraRejected: string[];
  mcp: string[];
  onMcp: (v: string[]) => void;
}) {
  const uid = useId();
  const reply = p.lookup.reply;
  const branches = useMemo(() => (reply?.ok ? reply.branches : []), [reply]);
  // Untouched (remembered/default) value: show every branch, not just matches.
  const filter = useMemo<OptionsFilter>(
    () =>
      ({ options, search }) => {
        if (!p.branch.typed) return options;
        const q = search.trim().toLowerCase();
        return options.filter((o) => "value" in o && o.value.toLowerCase().includes(q));
      },
    [p.branch.typed],
  );

  const repoInvalid = p.repoInput.trim() !== "" && !p.repo;
  let repoHint: ReactNode = "owner/repo or a Git URL";
  if (p.repo) repoHint = <>Checked out at <span className={classes.mono}>{p.checkoutPath}</span></>;

  let branchHint: ReactNode = undefined;
  let branchError: ReactNode = undefined;
  if (reply && !reply.ok) {
    if (reply.notFound) branchError = reply.error;
    else branchHint = "Branch lookup is unavailable on this cluster; the branch is checked when the Pod starts.";
  } else if (reply?.ok) {
    const def = reply.defaultBranch;
    if (p.branch.typed && p.lookup.refExists === false) {
      branchError = (
        <>
          Not found in {reply.repo}.
          {def && def !== p.branch.value && (
            <>
              {" "}
              <Anchor component="button" type="button" size="xs" onClick={() => p.onBranch(def)}>
                Use {def}
              </Anchor>
            </>
          )}
        </>
      );
    } else if (p.branch.substituted) {
      branchHint = `“${p.branch.substituted}” no longer exists; using the default branch.`;
    } else {
      branchHint = `${reply.branches.length}${reply.truncated ? "+" : ""} branches${def ? ` · default ${def}` : ""}`;
    }
  }

  if (!reply && p.repo?.github && p.lookup.loading) branchHint = "Looking up branches…";

  const ids = { cluster: `${uid}-cluster`, repo: `${uid}-repo`, branch: `${uid}-branch` };
  const toggleMcp = (server: string, on: boolean) => p.onMcp(MCP_SERVERS.filter((s) => (s === server ? on : p.mcp.includes(s))));

  return (
    <>
      <FormSection title="Workspace">
        {p.clusters.length > 1 && (
          <FormRow label="Cluster" labelFor={ids.cluster}>
            <Select
              id={ids.cluster}
              leftSection={<Server size={16} />}
              data={p.clusters.map((m) => ({ value: m.id, label: machineName(m.meta, m.id) }))}
              value={p.machine.id}
              onChange={(v) => v && p.onCluster(v)}
              allowDeselect={false}
              comboboxProps={within}
            />
          </FormRow>
        )}
        <FormRow label="Repository" labelFor={ids.repo}>
          <Autocomplete
            id={ids.repo}
            placeholder="owner/repo or Git URL"
            leftSection={<FolderGit2 size={16} />}
            data={p.repoOptions}
            limit={8}
            value={p.repoInput}
            onChange={p.onRepo}
            description={repoInvalid ? undefined : repoHint}
            error={repoInvalid ? "Use owner/repo or a full Git URL" : undefined}
            required
            data-autofocus
            openOnFocus={false}
            autoComplete="off"
            spellCheck={false}
            comboboxProps={within}
          />
        </FormRow>
        <FormRow label="Branch" labelFor={ids.branch}>
          <Autocomplete
            id={ids.branch}
            placeholder={reply?.ok ? reply.defaultBranch || "main" : "main"}
            leftSection={<GitBranch size={16} />}
            rightSection={p.lookup.loading ? <Loader size={14} /> : undefined}
            data={branches}
            filter={filter}
            limit={50}
            maxDropdownHeight={260}
            value={p.branch.value}
            onChange={p.onBranch}
            description={branchError ? undefined : branchHint}
            error={branchError}
            required
            autoComplete="off"
            spellCheck={false}
            comboboxProps={within}
          />
        </FormRow>
      </FormSection>
      <FormSection
        title="Additional repositories"
        footer={
          p.extraRejected.length
            ? undefined
            : p.repo
              ? `Cloned next to ${repoLabel(p.repo)}, with push access. Up to ${MAX_ADDITIONAL_REPOS}.`
              : `Cloned next to the main repository. Up to ${MAX_ADDITIONAL_REPOS}.`
        }
      >
        <FormRow layout="bare">
          <TagsInput
            aria-label="Additional repositories"
            variant="unstyled"
            classNames={{ input: classes.bareInput, error: classes.bareError }}
            error={p.extraRejected.length ? `Not a repository: ${p.extraRejected.join(", ")}` : undefined}
            placeholder={p.extraRepos.length ? undefined : "owner/other-repo"}
            data={p.repo ? p.repoOptions.filter((r) => r !== repoLabel(p.repo!)) : p.repoOptions}
            value={p.extraRepos}
            onChange={p.onExtraRepos}
            maxTags={MAX_ADDITIONAL_REPOS}
            splitChars={[",", " "]}
            acceptValueOnBlur
            clearable
            comboboxProps={within}
          />
        </FormRow>
      </FormSection>
      <FormSection title="Tools" footer={p.mcp.length ? "MCP servers started in the Pod. Switched-off servers are not started." : "The session starts without any default MCP server."}>
        {MCP_SERVERS.map((s) => {
          const { label, icon: Icon, tone } = MCP[s];
          return (
            <FormRow
              key={s}
              trailing
              labelFor={`${uid}-mcp-${s}`}
              label={
                <>
                  <span className={classes.toolIcon} data-tone={tone} aria-hidden>
                    <Icon size={15} strokeWidth={2} />
                  </span>
                  {label}
                </>
              }
            >
              <Switch id={`${uid}-mcp-${s}`} checked={p.mcp.includes(s)} onChange={(e) => toggleMcp(s, e.currentTarget.checked)} />
            </FormRow>
          );
        })}
      </FormSection>
    </>
  );
}
