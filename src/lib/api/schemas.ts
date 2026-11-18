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
});
export type SessionRow = z.infer<typeof sessionRow>;

export const sessionsV2Response = z.object({
  sessions: z.array(sessionRow),
  nextCursor: z.nullish(z.string()),
  hasNext: z.boolean(),
});

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
  z.looseObject({
    t: z.literal("update-machine"),
    machineId: z.string(),
    metadata: z.nullish(versioned),
    daemonState: z.nullish(versioned),
  }),
  z.looseObject({ t: z.literal("machine-deleted"), machineId: z.string() }),
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

export const rpcAck = z.looseObject({
  ok: z.optional(z.boolean()),
  result: z.optional(z.unknown()),
  error: z.optional(z.string()),
  code: z.optional(z.string()),
});
