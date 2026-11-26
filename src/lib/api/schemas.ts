// zod schemas for everything protobuf does not describe: the compat HTTP
// handlers (happy-cli-go internal/server/compat_handlers_*.go), whose JSON is
// hand-written rather than protobuf JSON, and socket.io payloads.
import { z } from "zod/mini";

const ms = z.int().check(z.nonnegative());
const int = z.int();

/** Message content: `{t:'encrypted',c}` object (socket), the same as a JSON
 * string (GET v3), or bare base64. Normalised to the base64 ciphertext. */
export const encryptedContent = z.pipe(
  z.union([z.object({ t: z.literal("encrypted"), c: z.string() }), z.string()]),
  z.transform((v, ctx) => {
    if (typeof v !== "string") return v.c;
    const s = v.trim();
    if (!s.startsWith("{")) return s;
    try {
      const parsed = JSON.parse(s) as { t?: unknown; c?: unknown };
      if (parsed.t === "encrypted" && typeof parsed.c === "string") return parsed.c;
    } catch {
      /* fallthrough */
    }
    ctx.issues.push({ code: "custom", message: "unrecognised message envelope", input: v });
    return z.NEVER;
  }),
);

export const messageRow = z.object({
  id: z.string(),
  seq: int,
  localId: z.nullish(z.string()),
  content: encryptedContent,
  createdAt: ms,
  updatedAt: z.optional(ms),
  role: z.optional(z.enum(["user", "agent"])),
});
export type MessageRow = z.infer<typeof messageRow>;

export const sessionRow = z.object({
  id: z.string(),
  seq: int,
  metadata: z.string(),
  metadataVersion: int,
  agentState: z.nullish(z.string()),
  agentStateVersion: int,
  dataEncryptionKey: z.nullish(z.string()),
  active: z.boolean(),
  archived: z._default(z.optional(z.boolean()), false),
  lifecycleStateCleartext: z._default(z.optional(z.string()), ""),
  activeAt: ms,
  createdAt: ms,
  updatedAt: ms,
  lastSeq: z.optional(int),
  /** Only its seq and time are kept (the content is dropped on parse). The
   * lite list (omit=lastMessage) leaves it out; /v2/sessions/active has it. */
  lastMessage: z.nullish(z.object({ seq: int, createdAt: ms })),
});
export type SessionRow = z.infer<typeof sessionRow>;

export const sessionsV2Response = z.object({
  sessions: z.array(sessionRow),
  nextCursor: z.nullish(z.string()),
  hasNext: z.boolean(),
});

export const activeSessionsResponse = z.object({ sessions: z.array(sessionRow) });

export const sessionResponse = z.object({ session: sessionRow });

export const machineRow = z.object({
  id: z.string(),
  seq: int,
  metadata: z.string(),
  metadataVersion: int,
  daemonState: z.nullish(z.string()),
  daemonStateVersion: int,
  dataEncryptionKey: z.nullish(z.string()),
  active: z.boolean(),
  activeAt: ms,
  createdAt: ms,
  updatedAt: ms,
});
export type MachineRow = z.infer<typeof machineRow>;

/** GET /v1/machines answers a bare array (Flutter also accepts {machines}). */
export const machinesResponse = z.union([
  z.array(machineRow),
  z.pipe(z.object({ machines: z.array(machineRow) }), z.transform((v) => v.machines)),
]);

export const messagesV3Response = z.object({ messages: z.array(messageRow), hasMore: z.boolean() });

export const sendMessagesV3Response = z.object({
  messages: z.array(z.object({ id: z.string(), seq: int, localId: z.nullish(z.string()), createdAt: ms })),
});

export const successResponse = z.object({ success: z.boolean() });

/** GET /v1/account/settings (compat_handlers_account.go): `settings` is the
 * legacy-secretbox ciphertext, null when none was ever saved. */
export const accountSettingsResponse = z.object({ settings: z.nullish(z.string()), settingsVersion: z.catch(int, 0) });

/** POST /v1/account/settings (compare-and-swap on `expectedVersion`):
 * `{success, version}`, or on a conflict `{success: false, error:
 * "version-mismatch", currentVersion, currentSettings}`. */
export const updateAccountSettingsResponse = z.object({
  success: z.boolean(),
  version: z.optional(int),
  error: z.nullish(z.string()),
  currentVersion: z.optional(int),
  currentSettings: z.nullish(z.string()),
});

/** GET /v1/kv/:key; `value` is standard base64. */
export const kvEntryResponse = z.object({ key: z.string(), value: z.nullish(z.string()), version: int });

/** POST /v1/usage/query (compat_handlers_usage.go). */
export const usageDataPoint = z.object({
  timestamp: int,
  tokens: z.record(z.string(), z.number()),
  cost: z.record(z.string(), z.number()),
  reportCount: int,
});
export type UsageDataPoint = z.infer<typeof usageDataPoint>;

export const usageQueryResponse = z.object({
  usage: z.array(usageDataPoint),
  groupBy: z.string(),
  totalReports: int,
});
export type UsageQueryResponse = z.infer<typeof usageQueryResponse>;

// ---- socket.io ------------------------------------------------------------

const versioned = z.object({ value: z.nullish(z.string()), version: int });

export const updateBody = z.discriminatedUnion("t", [
  z.object({ t: z.literal("new-message"), sid: z.string(), message: messageRow }),
  z.looseObject({ t: z.literal("new-session"), id: z.string() }),
  z.object({ t: z.literal("delete-session"), sid: z.string() }),
  z.object({ t: z.literal("archive-session"), sid: z.string(), archived: z.boolean() }),
  z.looseObject({
    t: z.literal("update-session"),
    id: z.string(),
    metadata: z.nullish(versioned),
    agentState: z.nullish(versioned),
  }),
  z.looseObject({ t: z.literal("new-machine"), machineId: z.string() }),
  z.looseObject({ t: z.literal("update-account"), settings: z.nullish(versioned) }),
  z.looseObject({
    t: z.literal("update-machine"),
    machineId: z.string(),
    metadata: z.nullish(versioned),
    daemonState: z.nullish(versioned),
  }),
  z.looseObject({ t: z.literal("machine-deleted"), machineId: z.string() }),
  z.looseObject({
    t: z.literal("kv-batch-update"),
    changes: z.array(z.looseObject({ key: z.string(), value: z.nullish(z.string()), version: int })),
  }),
]);
export type UpdateBody = z.infer<typeof updateBody>;

export const updateEnvelope = z.object({ id: z.string(), seq: int, body: z.unknown(), createdAt: ms });

export const ephemeral = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("activity"),
    id: z.string(),
    active: z.boolean(),
    activeAt: ms,
    thinking: z.optional(z.boolean()),
  }),
  z.object({
    type: z.literal("alive-batch"),
    sessions: z.array(z.object({ id: z.string(), activeAt: ms, thinking: z.optional(z.boolean()) })),
  }),
  z.object({ type: z.literal("machine-activity"), id: z.string(), active: z.boolean(), activeAt: ms }),
  z.object({ type: z.literal("message-stream"), id: z.string(), message: z.string() }),
]);
export type Ephemeral = z.infer<typeof ephemeral>;

/** Ack of machine-update-metadata (socket, compare-and-swap). */
export const metadataAck = z.looseObject({
  result: z.string(),
  version: z.optional(int),
  metadata: z.optional(z.nullable(z.string())),
  message: z.optional(z.string()),
});
export type MetadataAck = z.infer<typeof metadataAck>;

export const rpcAck = z.looseObject({
  ok: z.optional(z.boolean()),
  result: z.optional(z.unknown()),
  error: z.optional(z.string()),
  code: z.optional(z.string()),
});
