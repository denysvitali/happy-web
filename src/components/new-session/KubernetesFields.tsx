import { Anchor, Autocomplete, Checkbox, Input, Loader, Select, Stack, TagsInput, Text, type OptionsFilter } from "@mantine/core";
import { FolderGit2, GitBranch, Server } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { MachineItem } from "@/lib/sync/account";
import { machineName } from "@/lib/sync/decode";
import { MAX_ADDITIONAL_REPOS, MCP_SERVERS, repoLabel, type RepoRef } from "@/lib/sync/spawn";
import classes from "./new-session.module.css";
import type { BranchLookup } from "./useRepoBranches";

const within = { withinPortal: false } as const;

const MCP_LABELS: Record<(typeof MCP_SERVERS)[number], string> = {
  "github-actions": "GitHub Actions",
  loki: "Loki logs",
  prometheus: "Prometheus metrics",
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

  return (
    <Stack gap="md">
      {p.clusters.length > 1 && (
        <Select
          label="Cluster"
          leftSection={<Server size={16} />}
          data={p.clusters.map((m) => ({ value: m.id, label: machineName(m.meta, m.id) }))}
          value={p.machine.id}
          onChange={(v) => v && p.onCluster(v)}
          allowDeselect={false}
          comboboxProps={within}
        />
      )}
      <Autocomplete
        label="Repository"
        placeholder="owner/repo or https://github.com/owner/repo"
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
      <Autocomplete
        label="Branch"
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
      <TagsInput
        label="Additional repositories"
        description={
          p.extraRejected.length
            ? undefined
            : p.repo
              ? `Cloned next to ${repoLabel(p.repo)}, with push access. Up to ${MAX_ADDITIONAL_REPOS}.`
              : `Cloned next to the main repository. Up to ${MAX_ADDITIONAL_REPOS}.`
        }
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
      <Input.Wrapper label="Tools (MCP servers)" description="Unselected servers are not started in the Pod.">
        <Checkbox.Group value={p.mcp} onChange={p.onMcp} mt={8}>
          <div className={classes.mcp}>
            {MCP_SERVERS.map((s) => (
              <Checkbox key={s} value={s} label={MCP_LABELS[s]} size="sm" />
            ))}
          </div>
        </Checkbox.Group>
      </Input.Wrapper>
      {p.mcp.length === 0 && (
        <Text size="xs" c="dimmed" mt={-8}>
          The session starts without any default MCP server.
        </Text>
      )}
    </Stack>
  );
}
