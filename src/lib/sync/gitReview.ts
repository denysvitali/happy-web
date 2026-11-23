// Read-only Git queries run in the same checkout as the session, including pods.
import type { FileRpc } from "./files";

type Bash = FileRpc["bash"];
type FileKind = "working" | "staged" | "untracked" | "commit" | "outgoing";
export interface ChangedFile {
  path: string;
  status: string;
  kind: FileKind;
}
export interface ReviewRange {
  base: string;
  head: string;
}
export interface Commit {
  hash: string;
  date: string;
  subject: string;
}

const setup = `
export LC_ALL=C
if ! command -v git >/dev/null; then exit 41; fi
git() { command git --no-pager --no-optional-locks --literal-pathspecs -c core.fsmonitor=false "$@"; }
root=$(git rev-parse --show-cdup 2>/dev/null) && [ "$(git rev-parse --is-inside-work-tree)" = true ] || exit 42
cd "./$root" || exit
`;
const diff = "git diff --no-color --no-ext-diff --no-textconv --no-renames --ignore-submodules=none --submodule=short";
const hash = (value: string) => {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) throw new Error("Invalid Git revision.");
  return value;
};
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

async function read(bash: Bash, script: string, patch = false) {
  const result = await bash(`${setup}\n${script}`, "");
  if (!result.success) {
    if (result.exitCode === 41) throw new Error("Git is unavailable in this session.");
    if (result.exitCode === 42) throw new Error("The session directory is outside a Git working tree.");
    if (result.exitCode === 43) throw new Error("The parent commit is missing from this checkout. Git needs more history to show this diff.");
    if (result.exitCode === 44) throw new Error("Git could not find a common ancestor with the upstream in this checkout.");
    throw new Error("Git could not read this checkout. Refresh to try again.");
  }
  if (result.stdoutTruncated && !patch) throw new Error("Git returned more data than the session can display.");
  return result;
}

export async function reviewChanges(bash: Bash) {
  const { stdout } = await read(bash, `
branch=$(git symbolic-ref --quiet --short HEAD || printf 'Detached HEAD')
printf '%s\\0' "$branch"
git status --porcelain=v1 -z --no-renames --untracked-files=all --ignore-submodules=none
`);
  const [branch, ...records] = stdout.split("\0");
  const files: ChangedFile[] = [];
  for (const record of records.filter(Boolean)) {
    const [index, worktree] = record;
    const path = record.slice(3);
    if (index === "?" && worktree === "?") {
      files.push({ path, status: "A", kind: "untracked" });
    } else if (["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(record.slice(0, 2))) {
      files.push({ path, status: "U", kind: "working" });
    } else {
      if (index && index !== " ") files.push({ path, status: index, kind: "staged" });
      if (worktree && worktree !== " ") files.push({ path, status: worktree, kind: "working" });
    }
  }
  return { branch, files };
}

export async function reviewCommits(bash: Bash): Promise<Commit[]> {
  const { stdout } = await read(bash, `
if git rev-parse --verify --quiet HEAD >/dev/null; then
  git log -z -30 --format='%H%x00%as%x00%s' HEAD --
fi
`);
  const fields = stdout.split("\0");
  const commits: Commit[] = [];
  for (let i = 0; i + 2 < fields.length; i += 3) {
    commits.push({ hash: hash(fields[i]!), date: fields[i + 1]!, subject: fields[i + 2]! });
  }
  return commits;
}

function changedFiles(output: string, kind: "commit" | "outgoing") {
  const fields = output.split("\0");
  const files: ChangedFile[] = [];
  for (let i = 0; i + 1 < fields.length && fields[i]; i += 2) {
    files.push({ path: fields[i + 1]!, status: fields[i]!, kind });
  }
  return files;
}

export async function reviewCommit(bash: Bash, revision: string) {
  const head = hash(revision);
  const { stdout } = await read(bash, `
git cat-file -e ${head}^{commit} || exit
base=$(git cat-file commit ${head} | sed -n '2s/^parent //p; 2q')
if [ -z "$base" ]; then
  base=$(git hash-object -t tree /dev/null) || exit
else
  git cat-file -e "$base^{tree}" || exit 43
fi
printf '%s\\0' "$base"
${diff} --name-status -z "$base" ${head} --
`);
  const end = stdout.indexOf("\0");
  return { range: { base: hash(stdout.slice(0, end)), head }, files: changedFiles(stdout.slice(end + 1), "commit") };
}

export async function reviewOutgoing(bash: Bash) {
  const { stdout } = await read(bash, `
upstream=$(git rev-parse --symbolic-full-name '@{upstream}' 2>/dev/null) || exit 0
head=$(git rev-parse --verify HEAD) || exit
tip=$(git rev-parse --verify "$upstream") || exit
counts=$(git rev-list --left-right --count "$tip...$head") || exit
base=$(git merge-base "$tip" "$head") || exit 44
printf '%s\\0' "$upstream" "$base" "$head" "$counts"
${diff} --name-status -z "$base" "$head" --
`);
  if (!stdout) return null;
  const [upstream, base, head, counts, ...files] = stdout.split("\0");
  const [behind, ahead] = counts!.split(/\s+/).map(Number);
  return {
    upstream: upstream!.replace(/^refs\/(remotes|heads)\//, ""),
    ahead,
    behind,
    range: { base: hash(base!), head: hash(head!) },
    files: changedFiles(files.join("\0"), "outgoing"),
  };
}

export async function reviewPatch(bash: Bash, file: ChangedFile, range?: ReviewRange) {
  const path = quote(file.path);
  const revisions = range ? `${hash(range.base)} ${hash(range.head)}` : file.kind === "staged" ? "--cached" : "";
  const script = file.kind === "untracked"
    ? `if [ -L ${path} ] || [ -f ${path} ]; then
  ${diff} --no-index -- /dev/null ${path} || [ "$?" -eq 1 ]
fi`
    : `${diff} ${revisions} -- ${path}`;
  const { stdout, stdoutTruncated } = await read(bash, script, true);
  return { patch: stdout, truncated: stdoutTruncated };
}
