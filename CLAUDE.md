# CLAUDE.md

`happy-web`: small React client for the Happy server. Companion, not a
feature-parity rewrite of `happy_flutter`. Keep it fast and small (CI budget:
initial JS ≤ 250 KB gzip).

## Commands
`mise install`, then `pnpm install`, `pnpm dev`, `pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm build`, `pnpm size`, `pnpm generate` (buf, needs access to
happy-cli-go), `pnpm vectors` (regenerates crypto vectors from a sibling
happy-cli-go checkout).

## Wire-format sources of truth
Server wins over Flutter; record every discrepancy in README.md.
- Protos: happy-cli-go `proto/server/v1`, `proto/rpc/v1` → `src/gen` (generated, committed, never edit).
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
- Pinned deps (`save-exact`), Renovate keeps them fresh.
