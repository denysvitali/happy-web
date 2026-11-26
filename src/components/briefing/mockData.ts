// Clean, realistic multi-day sample data for the minimal List vs Projects preview.
import type { SimpleProject, SimpleSession } from "./model";

const MIN = 60_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

export interface SimpleDataset {
  now: number;
  projects: SimpleProject[];
  sessions: SimpleSession[];
}

export function createSimpleDemo(now = Date.now()): SimpleDataset {
  const projects: SimpleProject[] = [
    {
      id: "happy",
      name: "Happy",
      summary: "Rollback ready for your check · k8s spawn paused after root cause",
    },
    {
      id: "linux",
      name: "Linux Porting",
      summary: "Needs OK to reload hi6250-drm on bach2",
    },
    {
      id: "k2",
      name: "K2",
      summary: "Waiting on you: Protobuf vs JSON wire framing",
    },
    {
      id: "re",
      name: "RE",
      summary: "DMA IOCTL notes written in docs/ioctl.md",
    },
    {
      id: "public",
      name: "Public",
      summary: "No active sessions",
      quiet: true,
    },
  ];

  const sessions: SimpleSession[] = [
    {
      id: "s-rollback",
      projectId: "happy",
      title: "Context clear & rollback",
      statusLine: "Done on main — ready for your check",
      dot: "attention",
      updatedAt: now - 12 * MIN,
      repo: "acme/happy-web",
      branch: "main",
      host: "K8s",
      dirtySummary: "6 uncommitted files (+340/-80)",
      pending: {
        kind: "review",
        prompt: "Implemented rollback UI, undo flow, and 14 unit tests on main. Ready for your visual check before committing.",
      },
    },
    {
      id: "s-k8s",
      projectId: "happy",
      title: "Debug k8s spawn failures",
      statusLine: "Found watch timeout; fix not applied yet",
      dot: "paused",
      updatedAt: now - 2 * HOUR,
      repo: "acme/happy-cli-go",
      branch: "fix/spawn-watch",
      host: "dev-box",
      dirtySummary: "1 unpushed commit",
    },
    {
      id: "s-bach2",
      projectId: "linux",
      title: "bach2 GPU bring-up",
      statusLine: "Needs OK to reload hi6250-drm",
      dot: "attention",
      updatedAt: now - 2 * MIN,
      repo: "tildeknown/linux-hi6250",
      branch: "hi6250-egl",
      host: "root@bach2 (go)",
      dirtySummary: "2 uncommitted files (+64/-12)",
      pending: {
        kind: "approval",
        prompt: "Needs permission to reload the DRM kernel module before running kmscube.",
        command: "sudo modprobe -r hi6250-drm && sudo modprobe hi6250-drm debug=1",
      },
    },
    {
      id: "s-k2-wire",
      projectId: "k2",
      title: "Wire framing",
      statusLine: "Waiting on you: Protobuf vs JSON",
      dot: "attention",
      updatedAt: now - 3 * DAY,
      repo: "private/k2-core",
      branch: "proto-framing",
      host: "laptop",
      dirtySummary: "2 uncommitted files (+190/-24)",
      pending: {
        kind: "question",
        prompt: "Protobuf cuts payload size by 58% and matches happy-cli-go; JSON is easier to inspect while debugging. Which should I generate?",
        options: ["Use Protobuf", "Start with JSON"],
      },
    },
    {
      id: "s-re-ioctl",
      projectId: "re",
      title: "Decode DMA IOCTLs",
      statusLine: "Notes saved in docs/ioctl.md",
      dot: "paused",
      updatedAt: now - 2 * DAY,
      repo: "re/hi6250-boot",
      branch: "main",
      host: "laptop",
      dirtySummary: "3 uncommitted files",
    },
    // Quiet / older sessions folded cleanly out of sight
    {
      id: "s-happy-bundle",
      projectId: "happy",
      title: "Audit bundle size guardrail",
      statusLine: "Confirmed 140 KB gzip — no changes needed",
      dot: "paused",
      updatedAt: now - 30 * HOUR,
      repo: "acme/happy-web",
      branch: "main",
      host: "K8s",
      older: true,
    },
    {
      id: "s-galaxy-wifi",
      projectId: "linux",
      title: "Galaxy Tab S2 Wi-Fi check",
      statusLine: "Verified firmware loads cleanly on 6.12",
      dot: "paused",
      updatedAt: now - 42 * HOUR,
      repo: "tildeknown/linux-galaxy",
      branch: "wifi-fw",
      host: "galaxy-tab",
      older: true,
    },
    {
      id: "s-re-strings",
      projectId: "re",
      title: "Splash partition strings scan",
      statusLine: "Confirmed RLE RGB565 header format",
      dot: "paused",
      updatedAt: now - 4 * DAY,
      repo: "re/hi6250-boot",
      branch: "main",
      host: "laptop",
      older: true,
    },
    {
      id: "s-public-post",
      projectId: "public",
      title: "E2E encrypted sync post",
      statusLine: "Published and merged (#14)",
      dot: "paused",
      updatedAt: now - 9 * DAY,
      repo: "public/notes",
      branch: "main",
      host: "laptop",
      older: true,
    },
  ];

  return { now, projects, sessions };
}
