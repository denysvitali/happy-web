# CLAUDE.md

`happy-web`: small React client for the Happy server. Companion, not a
feature-parity rewrite of `happy_flutter`. Keep it fast and small (CI budget:
initial JS soft guardrail 400 KB gzip; lazy-load heavy, rarely used UI).

## Commands
`mise install`, then `pnpm install`, `pnpm dev`, `pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm test:e2e` (Playwright, mocked server), `pnpm build`, `pnpm size`, `pnpm generate` (buf; run after clone
and after bumping the pinned `ref` in buf.gen.yaml; needs access to happy-cli-go), `pnpm vectors` (regenerates crypto vectors from a sibling
happy-cli-go checkout).

## Wire-format sources of truth
Server wins over Flutter; record every discrepancy in README.md.
- Protos: happy-cli-go `proto/server/v1`, `proto/rpc/v1` → `src/gen` (generated, gitignored, CI generates it with secret `HAPPY_CLI_GO_TOKEN`).
- HTTP: grpc-gateway (`internal/server/server.go`) for auth; most session/machine/message
  routes are compat handlers (`internal/server/compat_handlers_*.go`) with non-proto JSON → zod.
- Realtime: `internal/server/ws/`, `internal/wsapi`.
- Crypto: `internal/api/cryptoutil` (+ `flutter_compat_test.go` for key derivation).
- Semantics: happy-cli-go `CLAUDE.md` Key Invariants, `docs/operations/reference.md`.
- Behaviour: `happy_flutter`.

## Rules
- `.githooks/pre-commit` runs lint, typecheck and tests; keep it green, do not bypass it.
- Decrypted content is typed `Decrypted<T>`; never `dangerouslySetInnerHTML` (lint-enforced).
- Never log tokens, secrets, or payloads. Secret lives in IndexedDB only.
- No CDNs, analytics or inline scripts; CSP in `index.html` + `src/lib/csp.ts`.
- UI is Mantine (CSS modules for custom styling). CSP is `style-src 'self'`, so nothing may
  inject `<style>` at runtime: MantineProvider runs with `withCssVariables`/`withGlobalClasses`
  off, Modal/Drawer use `lockScroll={false}`, and avoid `AppShell`, responsive style props and
  `SimpleGrid`/`Grid` breakpoints. The e2e smoke test fails on any CSP violation.
- Design system: `src/ui/` holds app-agnostic building blocks (NavBar, List, SearchField,
  SectionHeader, EmptyState, StatCard, FormSection, Sheet, Callout, Disclosure, StatusPill,
  IconButton, CopyButton, SwipeAction, `showUndo`, …); `src/ui/mantine/*` are the global Mantine skins wired in
  `src/theme.ts`. Colours, radii, type, motion come only from `--happy-*` tokens in
  `src/ui/tokens.css` (Mantine's variables are re-pointed there); never hard-code them.
  Tokens sit on `body`, not `:root`: postcss-preset-mantine rewrites `light-dark()` into
  scheme selectors that cannot match `:root`. Mantine CSS is imported as `styles.layer.css`
  so our CSS modules always win. Every component appears in `/components-demo`
  (`src/routes/demo.tsx`).
- Wide screens: the sidebar resizes from its edge and folds to an icon rail (toggle or
  Cmd/Ctrl+B); per-browser in localStorage (`shell/sidebarLayout.ts`), ignored on phones.
- Phones (<48em) use push navigation, not a drawer: `/` is the session list, a chat opens
  full-screen with a back button (the last 3 closed chats stay loaded, socket-fed, so going
  back and in does not reload them). A sub-agent card opens its own read-only page
  (`/s/$sessionId/agent/$toolId`, built from the parent chat's store).
- Pinned deps (`save-exact`), Renovate keeps them fresh.
- Visual inspection is required after any UI change: `pnpm screenshots` (phone + desktop,
  light + dark) and look at the PNGs. It self-provisions Chromium, even rootless (no apt
  needed; `scripts/e2e-setup.sh`), so "can't launch the browser" is a bug to fix, not a skip; a Stop hook (`.claude/hooks/visual-check.sh`) blocks
  finishing while UI sources are newer than the last screenshots. Chat changes are judged on
  the mocked ops session (`opsRecords` in `src/components/chat/fixtures.ts`, shots `screenshots/*-ops*.png`).
- Transcript: plain tool calls and thinking fold into one-line `steps` runs (`groupSteps`);
  sub-agents, unanswered questions and pending permissions stay out as cards. Finished turns
  fold their working into one `work` line above the final reply (`groupTurns`); the live
  turn and anything waiting for the user never fold.
  The Working row under a live turn says what is happening now (`liveActivity` in
  `tools/steps.ts`): the running call (a sub-agent's own, if deeper) and its time, else
  "Waiting for you", "Writing reply" or "Thinking" (+ "quiet Ns" after 30s with no new step),
  then the turn's step/agent counts and elapsed time; one line, never moves the transcript.
  A call with no result is closed as interrupted once a later `ready` ends its turn or the
  session is halted (`isHalted`); questions, pending permissions and background agents wait.
  A pending AskUserQuestion is answered in the card (no Allow/Deny bar): picks go back on the
  `permission` RPC as `updatedInput.answers` (question → comma-joined labels); Skip denies.
  Models: Claude's `message.model` (what actually answered, so fallbacks show; never its
  `meta.model`, which is the selected alias), else payload/meta `model`. A change per thread
  is a `model` block that never folds; agent replies show their model on hover.
  The picker chip shows the selection, but Default (and ids the catalog lacks, e.g. old
  daemons' guessed `claude-sonnet-5-5`) show the model that answered (`chipLabel`).
- Find in session (Cmd/Ctrl+F or the header button; the list is virtualized, so browser find
  misses most of it): client-side over loaded history (E2E), "Earlier" pages older in. Hits
  open their folds (`useFold` in `chat/reveal.ts`); matches are painted with the CSS Custom
  Highlight API (`::highlight` rules in `app.css`), never by rewriting the DOM.
- New session "System prompt" (Advanced, Claude only): spawn env `HAPPY_APPEND_SYSTEM_PROMPT`, which the
  daemon passes as `--append-system-prompt`. Not re-sent on provider switch restores.
- Composer task chip (`plan.tsx`): Happy session ToDos (encrypted `metadata.todos`,
  `src/lib/sync/todos.ts`) count when present, else the unfinished TodoWrite plan.
- Session list: grouped by project by default (approvals pinned on top, archive collapsed;
  "Group by" in the filter menu). Touch: swipe a row left to archive it (stops a live session
  first; no confirm, Undo in the toast). Avatars are identicons (`SessionAvatar`): tint from the
  project, glyph from the session id; changing `hashString` or reordering `SESSION_GLYPHS`
  re-skins every session.
- New session: right-click a project header (local dirs) → "New session in this directory…"
  opens the modal preselected to that directory. MCP options live under Advanced (Kubernetes
  mode); Bypass is the default permission mode for every agent (other modes are switchable).
- Session folders: one E2E-encrypted KV doc shared with Flutter and agents
  (happy-cli-go `docs/operations/session-folders.md`). `src/lib/sync/folders.ts`
  holds the pure model, `folderSync.ts` the optimistic, version-checked sync,
  `folderList.ts` the foldered list (search stays flat). Never write a doc you
  can't read. Bulk filing: Cmd/Ctrl/Shift-click or the row menu's "Select" (phones), and
  drag onto a folder row: HTML5 drag-and-drop for mice/pens, and on touch a long press lifts
  the row (`touchDrag.ts`, pointer events; let go without moving = the row menu). `pnpm vectors` also regenerates the Go folder envelopes.
- Inbox (`/inbox`, lazy): agents' `inbox_send` messages from each session's encrypted
  `metadata.inbox` (`src/lib/sync/inbox.ts`; same rules as happy_flutter). Read/done/replied
  is the user's triage (Done = acknowledge; filing offers Undo); a reply is a user message `Re: <subject>\n\n<text>`.
- Files (`/s/$sessionId/files?path=`, lazy; session menu "Browse files"): the session's
  own `listDirectory`/`readFile`/`bash` RPCs, confined to its cwd (in the Pod for k8s), any agent, running sessions only.
  Always send absolute paths. `readFile` caps at 1 MiB, so bigger downloads stream as 768 KiB
  `dd | base64` chunks over `bash` (path via stdin, never in the command), up to 512 MiB.
  Uploads (button or drop, into the open folder): `writeFile` up to 3 MiB, else parallel
  `dd seek` chunks into a hidden temp file, size-checked and `mv`'d into place; existing
  names need a Replace confirm, directories are never replaced.
  "New directory" (`mkdir`) and the row menu's Delete (`rm -rf`, confirmed) also go over
  `bash` with the path on stdin; `removePath` refuses `/` and relative paths.
- Machine sheet (Settings → Machines, or a session's menu "Machine…"; `account/MachineSheet.tsx`,
  lazy via `account/open.ts`): the Happy daemon
  (`get-daemon-version`/`update-daemon`) and agent CLIs (`get-provider-versions`/`update-provider`),
  parsed in `src/lib/sync/machineUpdates.ts`. Updates are daemon-side jobs: start, then poll the
  cached status; any successful update restarts the daemon, so each one is confirmed first.
  Old daemons answer `method_unsupported`.
- Deploys: the build writes `version.json`; open tabs poll it and offer a reload
  (`src/app/version.ts`). connect-src therefore includes `'self'`.
- Session list fetch (`listCache.ts`): lite `/v2/sessions` (`omit=lastMessage,agentState`) +
  `/v2/sessions/active` overlay, cached as ciphertext rows in IndexedDB, refreshed by
  `changedSince` deltas plus an id check (`omit=metadata`) for deletions/new messages; full
  listing only with an empty cache (daily on servers without `omit=metadata`).
  Refresh via `refreshList()` (coalesced, never cancels a listing); prefer socket patches.
- Unread badges: `src/lib/sync/unread.ts` keeps each session's seen seq and counts
  main-thread agent replies only. Seen marks and Inbox triage are cached in localStorage and
  synced across browsers by `readSync.ts` (KV `read-state`, merge-only; format in README).
  A fresh browser counts only after that doc loads, or its "all seen" baseline would clear
  every other browser's badges.
- Image attachments follow happy_flutter: user content becomes a block array with base64
  `image` blocks (≤1568px, ≤3.4 MB base64); Har/OpenCode are text-only.
