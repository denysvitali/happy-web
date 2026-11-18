# happy-web

A fast, lightweight web client for the [Happy](https://github.com/denysvitali/happy-cli-go)
server: link this browser from the Happy app, then follow, steer and start agent sessions
(Claude Code, Codex, OpenCode, …). It's a companion client, not a feature-parity rewrite of
`happy_flutter`.

Live: <https://happyw.denv.it> · UI snapshots of the latest build: <https://happyw.denv.it/screenshots/>

## Development

```sh
mise install          # node, pnpm (pinned in mise.toml)
pnpm install          # also enables the pre-commit hook (.githooks)
pnpm generate         # protobuf-es types from happy-cli-go (needs read access, see below)
pnpm dev              # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | ESLint, `tsc --noEmit`, Vitest unit tests |
| `pnpm test:e2e` | Playwright smoke test against a mocked server (also fails on CSP violations) |
| `pnpm screenshots` | Renders key screens (desktop + mobile, light + dark) into `screenshots/` with an HTML gallery |
| `pnpm build` / `pnpm size` | Production build and the initial-JS size guardrail |
| `pnpm vectors` | Regenerates crypto test vectors from a sibling `happy-cli-go` checkout (needs Go) |

`src/gen` is generated, not committed. `buf.gen.yaml` pulls the protos from a pinned
`happy-cli-go` commit (`proto/server/v1`, `proto/rpc/v1`). happy-cli-go is private, so CI
needs a repository secret `HAPPY_CLI_GO_TOKEN` (fine-grained, contents: read).

## Pointing it at a server

The first screen asks for the server URL. It's prefilled from the build-time
`VITE_HAPPY_SERVER_URL` (repository variable `HAPPY_SERVER_URL` for the Pages build), and
the value you choose is stored in `localStorage`. Only `https://` URLs are accepted
(`http://localhost` in dev builds). Changing it reloads the page, because the CSP is
narrowed to that origin at startup.

Then open the Happy app → **Settings → Account → Link New Device** and scan the QR code.

## Security model

- **End-to-end encryption.** The server only stores ciphertext. Linking uses the
  account-auth request/approve flow: the browser shows `happy:///account?<ephemeral X25519
  public key>`, the app answers with `box(masterSecret)`, and the server returns a token.
  Session and machine payloads use AES-256-GCM data keys (sealed to the account content
  key) or legacy NaCl secretbox. Both paths are tested against vectors produced by the Go
  code and by Flutter's own key derivation.
- **Storage.** The master secret and token live in IndexedDB only, never in URLs,
  `localStorage` or logs. **Forget this device** deletes the database.
- **CSP** (meta tag): `default-src 'self'`, `script-src 'self'`, `style-src 'self'`,
  `connect-src` limited to `https:`/`wss:` and narrowed at startup to the configured server
  origin. No inline scripts or styles, no CDNs, no analytics. Mantine runs without runtime
  `<style>` injection (static CSS variables), and the e2e suite fails on any violation.
- **Rendering.** Decrypted content is branded `Decrypted<T>` and rendered as React text or
  `react-markdown` with raw HTML disabled. `dangerouslySetInnerHTML` is banned by lint.
- **Supply chain.** Exact dependency versions plus a lockfile, and Renovate (actions pinned
  by digest).

## Architecture

```
src/lib/crypto     base64, secretbox / AES-GCM / box primitives, key derivation, per-row cipher
src/lib/api        fetch client: protobuf-es for grpc-gateway routes, zod for compat routes
src/lib/realtime   socket.io (user-scoped), typed events, encrypted RPC
src/lib/sync       account orchestrator, session/machine decoding, chat reducer, spawn helpers
src/components     Mantine UI (shell, sessions, chat, new-session, session toolbar)
src/routes         link, overview, chat, /components-demo
e2e/               Playwright mocks (HTTP + socket.io), smoke test, screenshot capture
```

Realtime events are never trusted to be gapless. Every (re)connect and every seq gap
triggers a catch-up from `GET /v3/sessions/:id/messages?after_seq=`. Sends are idempotent
via `localId`. Codex `message-stream` previews are replaced by the final message that has
the same `streamId`.

## Differences found between Flutter and the Go server

The server wins wherever they disagree. Found while building this client:

1. **Content-key derivation in the Go test helper is wrong.**
   `cryptoutil/flutter_compat_test.go`'s `flutterDeriveContentKey` keys the root HMAC with
   the master secret. Flutter (`derive_key.dart`) keys it with `"<usage> Master Seed"` and
   uses the secret as data. Daemons seal data keys to the public key the app sends, so
   Flutter's order is the effective one. This client follows Flutter, pinned by a vector
   produced by running Flutter's Dart code.
2. **Most REST routes aren't grpc-gateway JSON.** Sessions, machines and messages come
   from hand-written compat handlers. `GET /v1/machines` returns a bare array, sessions use
   `lifecycleStateCleartext`, and int64 values are JSON numbers. protobuf-es is used only
   for gateway routes (auth) and RPC payloads; everything else is validated with zod.
3. **`update-machine` carries `machineId`.** Flutter reads `id` and so ignores these
   updates. This client uses `machineId`.
4. **Flutter drops `lifecycleStateCleartext`** from REST-loaded sessions; this client uses it.
5. **Message `content` comes in two shapes:** an object `{t:'encrypted',c}` on the socket,
   and the same object as a JSON *string* from `GET /v3`.
6. **MCP server list.** The server knows `github-actions`, `loki` and `prometheus`; Flutter
   lists two, so deselecting one in Flutter also silently disables `prometheus`.
7. **`kubernetesCheckoutBaseDir` is read by Flutter but never published** by the daemon.
   Clients fall back to `/workspace`.
8. **Two meanings of "default" model.** In message meta, `model: null` means "no change";
   in a spawn request, `"default"` means the account default. Going back to Default inside
   a session needs a respawn.
9. **Codex sessions report no context usage** over the app-server path (token-usage
   notifications aren't forwarded), and Codex's `safe-yolo` permission mode maps to a
   read-only sandbox.
10. **Phantom fields.** Flutter sends `startupBashScript` and reads `runtimeType` /
    `podName` / `phase` from spawn responses; none of these exist in the proto.
11. **Rename.** Flutter calls `POST /v1/sessions/:id/rename`, which the server doesn't
    have. This client writes `name` (and `summary`) through
    `POST /v1/sessions/:id/metadata` with `expectedVersion`, retrying on version mismatch.
12. **No archived filter on `/v2/sessions`.** All sessions (archived included) are
    downloaded and decrypted. The UI only renders archived ones on demand, but the
    transfer cost remains until the server can filter.
