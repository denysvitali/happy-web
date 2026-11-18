# CLAUDE.md

`happy-web`: small React client for the Happy server. Companion, not a
feature-parity rewrite of `happy_flutter`. Keep it fast and small (CI budget:
initial JS ≤ 250 KB gzip).

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
  off (static CSS in `src/app.css`), Modal/Drawer use `lockScroll={false}`, and avoid
  `AppShell`, responsive style props and `SimpleGrid`/`Grid` breakpoints. The e2e smoke test
  fails on any CSP violation. Theme values that are CSS variables (brand palette, dark
  palette, fonts, radii, shadows) live in `src/theme.ts` and are mirrored statically in
  `src/app.css`; change both. Use `--mantine-primary-color-*`/`--mantine-color-brand-*`
  and the `--happy-*` surfaces in CSS modules, not hardcoded blue.
- Pinned deps (`save-exact`), Renovate keeps them fresh.
