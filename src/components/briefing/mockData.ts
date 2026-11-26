// Realistic multi-day mock dataset for the Briefing prototype.
// Models 10 sessions across 5 Spaces (including 1 quiet Space that stays out
// of the way unless searched) so you can feel how Briefing + Living Notebooks
// + Sweep compress multi-day sprawl into calm situational awareness.
import type { BriefingSession, Space, TurnItem } from "./model";

const MIN = 60_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

export interface BriefingDataset {
  now: number;
  spaces: Space[];
  sessions: BriefingSession[];
  turns: TurnItem[];
}

export function createMockBriefing(now = Date.now()): BriefingDataset {
  const spaces: Space[] = [
    {
      id: "happy",
      name: "Happy",
      swatchKey: "acme/happy-web",
      match: { repos: ["*/happy-*", "happy-*"] },
      notebook: {
        goal: "Ship context clear + rollback in happy-web and harden K8s session spawns.",
        summary: "Rollback UI & tests are ready on main (needs your visual check); K8s spawn failures were root-caused to a pod watch timeout and await a retry patch.",
        knownFacts: [
          "Session list order stays sticky during activity bursts (ListOrder).",
          "K8s spawner watch stream drops silently after ~15m idle without resourceVersion resume.",
        ],
        blockers: [
          "Rollback branch has uncommitted UI changes waiting for visual review.",
          "Pod watch timeout patch in happy-cli-go not applied yet.",
        ],
        milestones: [
          { id: "m-h1", at: now - 2 * DAY, text: "Merged SSE reconnect backoff & unread sync fixes (#398)." },
          { id: "m-h2", at: now - 4 * DAY, text: "Shipped E2E-encrypted folder sync across Flutter & happy-web." },
        ],
        proposals: [
          {
            id: "prop-h1",
            kind: "fact",
            text: "Root cause of K8s spawn flake is watch-stream EOF before pod phase transitions to Running.",
            fromSessionId: "bs-k8s",
            fromTitle: "Debug k8s session spawn failures",
            createdAt: now - 2 * HOUR,
          },
        ],
        updatedAt: now - 12 * MIN,
      },
    },
    {
      id: "linux",
      name: "Linux Porting",
      swatchKey: "tildeknown/linux-hi6250",
      match: { repos: ["*/linux-*"], hosts: ["*bach2*", "*galaxy*"] },
      notebook: {
        goal: "Bring up KMS/GBM/EGL GPU acceleration on Huawei bach2 (hi6250).",
        summary: "Past panel timing and KMS modesetting; agent is actively testing DRM modifier flags in GBM on root@bach2.",
        knownFacts: [
          "Mainline 6.12 kernel boots to DRM framebuffer on hi6250.",
          "KMS atomic modesetting succeeds with linear format modifier.",
        ],
        blockers: [
          "gbm_bo_create returns EINVAL unless linear modifier is forced.",
        ],
        milestones: [
          { id: "m-l1", at: now - 3 * DAY, text: "Fixed DSI panel init sequence and verified KMS modesetting on bach2." },
          { id: "m-l2", at: now - 6 * DAY, text: "Galaxy Tab S2 Wi-Fi firmware load stabilized." },
        ],
        proposals: [],
        updatedAt: now - 4 * MIN,
      },
    },
    {
      id: "k2",
      name: "K2",
      swatchKey: "private/k2",
      match: { repos: ["*/k2*"] },
      notebook: {
        goal: "Finalize control-plane wire framing and device handshake.",
        summary: "Stalled 3d waiting on your call between Protobuf and canonical JSON framing.",
        knownFacts: [
          "Handshake round-trip stays under 4ms over local Unix socket.",
        ],
        blockers: [
          "Wire framing choice blocks codegen for daemon + mobile client.",
        ],
        milestones: [
          { id: "m-k1", at: now - 5 * DAY, text: "Drafted noise-protocol session key exchange spec." },
        ],
        proposals: [],
        updatedAt: now - 3 * DAY,
      },
    },
    {
      id: "re",
      name: "RE",
      swatchKey: "private/re-notes",
      match: { repos: ["*/re-*", "re/*"] },
      notebook: {
        goal: "Document bootloader partition layout and IOCTL table.",
        summary: "IOCTL table decoded; 2 older exploration sessions are idle and safe to close.",
        knownFacts: [
          "IOCTL 0xC0184D02 maps shared DMA ring buffer (64 KiB aligned).",
        ],
        blockers: [],
        milestones: [
          { id: "m-r1", at: now - 4 * DAY, text: "Extracted symbol table offsets for v2.4 bootloader." },
        ],
        proposals: [],
        updatedAt: now - 2 * DAY,
      },
    },
    {
      id: "public",
      name: "Public",
      swatchKey: "public/oss",
      match: { repos: ["public/*"] },
      notebook: {
        goal: "Public notes, blog drafts, and open-source patches.",
        summary: "Nothing active right now.",
        knownFacts: [],
        blockers: [],
        milestones: [
          { id: "m-p1", at: now - 9 * DAY, text: "Published post on E2E encrypted mobile agent clients." },
        ],
        proposals: [],
        updatedAt: now - 9 * DAY,
      },
    },
  ];

  const sessions: BriefingSession[] = [
    {
      id: "bs-rollback",
      repo: "acme/happy-web",
      branch: "main",
      host: "K8s",
      runtime: "kubernetes",
      agent: "agy",
      status: "active",
      state: {
        title: "Context clear & message rollback",
        now: "Implemented rollback UI, undo flow, and unit tests; ready for visual check.",
        next: "Review desktop/mobile screenshots and commit.",
        owner: "user",
        stage: "ready_to_review",
        updatedAt: now - 12 * MIN,
      },
      footprint: {
        gitDirtyFiles: 6,
        diffAdded: 340,
        diffRemoved: 80,
        podLive: true,
        todosDone: 5,
        todosTotal: 5,
      },
      lastActivityAt: now - 12 * MIN,
      transcriptExcerpt: [
        { role: "user", text: "Add context clear and message rollback/edit flow in chat." },
        { role: "agent", text: "Done — added rollback confirmation, transcript truncation sync, and 14 unit tests. Screenshots look clean; ready for your review before committing." },
      ],
    },
    {
      id: "bs-k8s",
      repo: "acme/happy-cli-go",
      branch: "fix/spawn-watch",
      host: "dev-box",
      runtime: "local",
      agent: "claude",
      status: "idle",
      state: {
        title: "Debug k8s session spawn failures",
        now: "Isolated watch-stream timeout in pod spawner; retry patch not applied yet.",
        next: "Apply resourceVersion resume patch and add fake-k8s test.",
        owner: "user",
        stage: "building",
        updatedAt: now - 2 * HOUR,
      },
      footprint: {
        gitDirtyFiles: 0,
        gitAhead: 1,
        todosDone: 2,
        todosTotal: 4,
      },
      lastActivityAt: now - 2 * HOUR,
      transcriptExcerpt: [
        { role: "user", text: "K8s session spawns intermittently hang after pod creation." },
        { role: "agent", text: "Found it: `watchPodReady` exits without re-listing when the apiserver closes the stream early. Ready to patch once you confirm we should bound retries to 3." },
      ],
    },
    {
      id: "bs-bach2",
      repo: "tildeknown/linux-hi6250",
      branch: "hi6250-egl",
      host: "root@bach2 (go)",
      runtime: "local",
      agent: "codex",
      status: "thinking",
      state: {
        title: "bach2 UI: KMS/GBM/EGL GPU bring-up",
        now: "Testing explicit linear DRM modifier in gbm_bo_create and rebuilding test harness.",
        next: "Run kmscube smoke test on bach2.",
        owner: "agent",
        stage: "building",
        updatedAt: now - 1 * MIN,
      },
      footprint: {
        gitDirtyFiles: 2,
        diffAdded: 64,
        diffRemoved: 12,
        todosDone: 3,
        todosTotal: 5,
      },
      lastActivityAt: now - 1 * MIN,
      transcriptExcerpt: [
        { role: "user", text: "Try passing DRM_FORMAT_MOD_LINEAR explicitly to gbm_bo_create_with_modifiers." },
        { role: "agent", text: "Patched `egl_surface.c`, compiling now. Need permission to reload `hi6250-drm` module before running kmscube." },
      ],
    },
    {
      id: "bs-k2-wire",
      repo: "private/k2-core",
      branch: "proto-framing",
      host: "laptop",
      runtime: "local",
      agent: "claude",
      status: "idle",
      state: {
        title: "Control-plane wire framing",
        now: "Benchmarked Protobuf vs canonical JSON; waiting on your pick to generate codecs.",
        next: "Choose framing format and generate Go + TS types.",
        owner: "user",
        stage: "blocked",
        updatedAt: now - 3 * DAY,
      },
      footprint: {
        gitDirtyFiles: 2,
        diffAdded: 190,
        diffRemoved: 24,
        todosDone: 1,
        todosTotal: 3,
      },
      lastActivityAt: now - 3 * DAY,
      transcriptExcerpt: [
        { role: "agent", text: "Protobuf cuts payload size by 58% and matches happy-cli-go tooling; JSON is easier to inspect on the wire. Which direction should I generate?" },
      ],
    },
    {
      id: "bs-happy-ci",
      repo: "acme/happy-web",
      branch: "main",
      host: "K8s",
      runtime: "kubernetes",
      agent: "claude",
      status: "idle",
      state: {
        title: "Audit bundle size guardrail",
        now: "Confirmed initial JS is 312 KB gzip (under 400 KB limit); no code changes needed.",
        next: "Safe to archive.",
        owner: "none",
        stage: "done",
        updatedAt: now - 30 * HOUR,
      },
      footprint: {
        gitDirtyFiles: 0,
        podLive: false,
      },
      lastActivityAt: now - 30 * HOUR,
      transcriptExcerpt: [
        { role: "agent", text: "Entry bundle is 312 KB gzip after lazy-loading Review and Files. No action needed." },
      ],
    },
    {
      id: "bs-galaxy-wifi",
      repo: "tildeknown/linux-galaxy",
      branch: "wifi-fw",
      host: "galaxy-tab",
      runtime: "local",
      agent: "claude",
      status: "idle",
      state: {
        title: "Galaxy Tab S2 Wi-Fi regression check",
        now: "Verified firmware path fix still applies cleanly on 6.12; nothing left pending.",
        next: "Safe to archive.",
        owner: "none",
        stage: "done",
        updatedAt: now - 42 * HOUR,
      },
      footprint: {
        gitDirtyFiles: 0,
      },
      lastActivityAt: now - 42 * HOUR,
      transcriptExcerpt: [
        { role: "agent", text: "Clean cherry-pick, `wlan0` associates cleanly after reboot." },
      ],
    },
    {
      id: "bs-re-ioctl",
      repo: "re/hi6250-boot",
      branch: "main",
      host: "laptop",
      runtime: "local",
      agent: "agy",
      status: "idle",
      state: {
        title: "Decode DMA ring IOCTL structs",
        now: "Mapped all 6 IOCTL command structs and saved notes in docs/ioctl.md.",
        next: "Commit docs/ioctl.md or discard scratch dump.",
        owner: "user",
        stage: "ready_to_review",
        updatedAt: now - 52 * HOUR,
      },
      footprint: {
        gitDirtyFiles: 3,
        diffAdded: 215,
        diffRemoved: 0,
      },
      lastActivityAt: now - 52 * HOUR,
      transcriptExcerpt: [
        { role: "agent", text: "Finished annotating the 64 KiB DMA ring descriptor in `docs/ioctl.md`. Left the raw dump untracked in `/tmp`." },
      ],
    },
    {
      id: "bs-re-strings",
      repo: "re/hi6250-boot",
      branch: "main",
      host: "laptop",
      runtime: "local",
      agent: "claude",
      status: "idle",
      state: {
        title: "Quick strings scan of splash image",
        now: "Confirmed splash partition uses standard RLE-encoded RGB565 header.",
        next: "Safe to archive.",
        owner: "none",
        stage: "done",
        updatedAt: now - 4 * DAY,
      },
      footprint: {
        gitDirtyFiles: 0,
      },
      lastActivityAt: now - 4 * DAY,
      transcriptExcerpt: [
        { role: "agent", text: "Header magic `SPLH` followed by width/height u16 LE and RLE RGB565 stream." },
      ],
    },
    {
      id: "bs-public-blog",
      repo: "public/notes",
      branch: "main",
      host: "laptop",
      runtime: "local",
      agent: "claude",
      status: "archived",
      state: {
        title: "Draft E2E encrypted agent sync post",
        now: "Published and merged to public/notes.",
        owner: "none",
        stage: "done",
        updatedAt: now - 9 * DAY,
      },
      footprint: { prNumber: 14, prState: "merged" },
      lastActivityAt: now - 9 * DAY,
      transcriptExcerpt: [],
    },
  ];

  const turns: TurnItem[] = [
    {
      id: "turn-bach2-modprobe",
      sessionId: "bs-bach2",
      spaceId: "linux",
      kind: "approval",
      headline: "Reload hi6250-drm kernel module on root@bach2",
      detail: "Needs approval to run a privileged command before launching kmscube.",
      command: "sudo modprobe -r hi6250-drm && sudo modprobe hi6250-drm debug=1",
      createdAt: now - 2 * MIN,
    },
    {
      id: "turn-rollback-review",
      sessionId: "bs-rollback",
      spaceId: "happy",
      kind: "ready_to_review",
      headline: "Rollback UI & 14 tests ready on happy-web",
      detail: "All 5 tasks completed on main (K8s pod live, +340/-80 uncommitted). Ready for your visual check before committing.",
      createdAt: now - 12 * MIN,
    },
    {
      id: "turn-k2-framing",
      sessionId: "bs-k2-wire",
      spaceId: "k2",
      kind: "question",
      headline: "Protobuf vs canonical JSON for K2 wire framing?",
      detail: "Protobuf cuts payload size by 58% and matches happy-cli-go tooling; JSON is easier to inspect during early debugging.",
      options: ["Use Protobuf", "Start with JSON", "Keep both behind codec"],
      createdAt: now - 3 * DAY,
    },
  ];

  return { now, spaces, sessions, turns };
}
