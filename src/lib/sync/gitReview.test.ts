import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { reviewChanges, reviewCommit, reviewCommits, reviewOutgoing, reviewPatch } from "./gitReview";

it("reviews Git from a nested session directory with literal filenames and separate index and working-tree patches", async () => {
  const root = mkdtempSync(join(tmpdir(), "happy-git-review-"));
  const cwd = join(root, "nested");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const path = "change [1]'\n.txt";
  const write = (contents: string) => writeFileSync(join(root, path), contents);
  const bash: Parameters<typeof reviewChanges>[0] = async (command, stdin) => {
    const result = spawnSync("sh", ["-c", command], { cwd, input: stdin, encoding: "utf8" });
    return { success: result.status === 0, exitCode: result.status ?? -1, stdout: result.stdout, stderr: result.stderr, error: "", stdoutTruncated: false };
  };

  try {
    mkdirSync(cwd);
    git("init", "-q", "-b", "review");
    git("config", "user.name", "Test");
    git("config", "user.email", "review@example.test");
    git("config", "commit.gpgsign", "false");
    expect(await reviewCommits(bash)).toEqual([]);
    expect(await reviewOutgoing(bash)).toBeNull();
    write("original\n");
    git("add", "--", path);
    git("commit", "-qm", "Initial commit");
    git("branch", "base");
    git("branch", "--set-upstream-to=base");
    write("committed\n");
    git("commit", "-qam", "Outgoing commit");

    write("staged\n");
    git("add", "--", path);
    write("unstaged\n");
    writeFileSync(join(root, "-new.txt"), "untracked\n");
    const changes = await reviewChanges(bash);
    expect(changes.branch).toBe("review");
    expect(changes.files).toEqual([
      { path, status: "M", kind: "staged" },
      { path, status: "M", kind: "working" },
      { path: "-new.txt", status: "A", kind: "untracked" },
    ]);
    expect((await reviewPatch(bash, changes.files[0]!)).patch).toContain("-committed\n+staged");
    expect((await reviewPatch(bash, changes.files[1]!)).patch).toContain("-staged\n+unstaged");
    expect((await reviewPatch(bash, changes.files[2]!)).patch).toContain("+untracked");

    const commits = await reviewCommits(bash);
    expect(commits.map((c) => c.subject)).toEqual(["Outgoing commit", "Initial commit"]);
    const initial = await reviewCommit(bash, commits[1]!.hash);
    expect(initial.files).toEqual([{ path, status: "A", kind: "commit" }]);
    expect((await reviewPatch(bash, initial.files[0]!, initial.range)).patch).toContain("+original");

    const outgoing = await reviewOutgoing(bash);
    expect(outgoing).toMatchObject({ upstream: "base", ahead: 1, behind: 0, files: [{ path, status: "M", kind: "outgoing" }] });
    expect((await reviewPatch(bash, outgoing!.files[0]!, outgoing!.range)).patch).toContain("-original\n+committed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
