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
  IconButton, CopyButton, …); `src/ui/mantine/*` are the global Mantine skins wired in
  `src/theme.ts`. Colours, radii, type, motion come only from `--happy-*` tokens in
  `src/ui/tokens.css` (Mantine's variables are re-pointed there); never hard-code them.
  Tokens sit on `body`, not `:root`: postcss-preset-mantine rewrites `light-dark()` into
  scheme selectors that cannot match `:root`. Mantine CSS is imported as `styles.layer.css`
  so our CSS modules always win. Every component appears in `/components-demo`
  (`src/routes/demo.tsx`).
- Phones (<48em) use push navigation, not a drawer: `/` is the session list, a chat opens
  full-screen with a back button. A sub-agent card opens its own read-only page
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
  A call with no result is closed as interrupted once a later `ready` ends its turn or the
  session is halted (`isHalted`); questions, pending permissions and background agents wait.
  A pending AskUserQuestion is answered in the card (no Allow/Deny bar): picks go back on the
  `permission` RPC as `updatedInput.answers` (question → comma-joined labels); Skip denies.
- Composer task chip (`plan.tsx`): Happy session ToDos (encrypted `metadata.todos`,
  `src/lib/sync/todos.ts`) count when present, else the unfinished TodoWrite plan.
- Session list: grouped by project by default (approvals pinned on top, archive collapsed;
  "Group by" in the filter menu). Avatars are identicons (`SessionAvatar`): tint from the
  project, glyph from the session id; changing `hashString` or reordering `SESSION_GLYPHS`
  re-skins every session.
- Session folders: one E2E-encrypted KV doc shared with Flutter and agents
  (happy-cli-go `docs/operations/session-folders.md`). `src/lib/sync/folders.ts`
  holds the pure model, `folderSync.ts` the optimistic, version-checked sync,
  `folderList.ts` the foldered list (search stays flat). Never write a doc you
  can't read. Bulk filing: Cmd/Ctrl/Shift-click or the row menu's "Select" (phones), and
  drag onto a folder row (fine pointers only; touch long-press stays the menu). `pnpm vectors` also regenerates the Go folder envelopes.
- Inbox (`/inbox`, lazy): agents' `inbox_send` messages from each session's encrypted
  `metadata.inbox` (`src/lib/sync/inbox.ts`; same rules as happy_flutter). Read/done/replied
  is per-browser triage in localStorage (Done = acknowledge; filing offers Undo); a reply is a user message `Re: <subject>\n\n<text>`.
- Files (`/s/$sessionId/files?path=`, lazy; session menu "Browse files"): the session's
  own `listDirectory`/`readFile`/`bash` RPCs, confined to its cwd (in the Pod for k8s), any agent, running sessions only.
  Always send absolute paths. `readFile` caps at 1 MiB, so bigger downloads stream as 768 KiB
  `dd | base64` chunks over `bash` (path via stdin, never in the command), up to 512 MiB.
- Deploys: the build writes `version.json`; open tabs poll it and offer a reload
  (`src/app/version.ts`). connect-src therefore includes `'self'`.
- Unread badges are per browser (no server read state): `src/lib/sync/unread.ts` keeps each
  session's seen seq in localStorage and counts main-thread agent replies only.
- Image attachments follow happy_flutter: user content becomes a block array with base64
  `image` blocks (≤1568px, ≤3.4 MB base64); Har/OpenCode are text-only.
