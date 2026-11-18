// zod schemas for everything protobuf does not describe: the compat HTTP
// handlers (happy-cli-go internal/server/compat_handlers_*.go), whose JSON is
// hand-written rather than protobuf JSON, and socket.io payloads.
import { z } from "zod";

const ms = z.number().int().nonnegative();

/** Message content: `{t:'encrypted',c}` object (socket), the same as a JSON
 * string (GET v3), or bare base64. Normalised to the base64 ciphertext. */
export const encryptedContent = z
  .union([z.object({ t: z.literal("encrypted"), c: z.string() }), z.string()])
  .transform((v, ctx) => {
    if (typeof v !== "string") return v.c;
    const s = v.trim();
    if (!s.startsWith("{")) return s;
    try {
      const parsed = JSON.parse(s) as { t?: unknown; c?: unknown };
      if (parsed.t === "encrypted" && typeof parsed.c === "string") return parsed.c;
    } catch {
      /* fallthrough */
    }
    ctx.addIssue({ code: "custom", message: "unrecognised message envelope" });
    return z.NEVER;
  });

export const messageRow = z.object({
  id: z.string(),
  seq: z.number().int(),
  localId: z.string().nullish(),
  content: encryptedContent,
  createdAt: ms,
  updatedAt: ms.optional(),
  role: z.enum(["user", "agent"]).optional(),
});
export type MessageRow = z.infer<typeof messageRow>;

export const sessionRow = z.object({
  id: z.string(),
  seq: z.number().int(),
  metadata: z.string(),
  metadataVersion: z.number().int(),
  agentState: z.string().nullish(),
  agentStateVersion: z.number().int(),
  dataEncryptionKey: z.string().nullish(),
  active: z.boolean(),
  archived: z.boolean().optional().default(false),
  lifecycleStateCleartext: z.string().optional().default(""),
  activeAt: ms,
  createdAt: ms,
  updatedAt: ms,
  lastSeq: z.number().int().optional(),
});
export type SessionRow = z.infer<typeof sessionRow>;

export const sessionsV2Response = z.object({
  sessions: z.array(sessionRow),
  nextCursor: z.string().nullish(),
  hasNext: z.boolean(),
});

export const sessionResponse = z.object({ session: sessionRow });

export const machineRow = z.object({
  id: z.string(),
  seq: z.number().int(),
  metadata: z.string(),
  metadataVersion: z.number().int(),
  daemonState: z.string().nullish(),
  daemonStateVersion: z.number().int(),
  dataEncryptionKey: z.string().nullish(),
  active: z.boolean(),
  activeAt: ms,
  createdAt: ms,
  updatedAt: ms,
});
export type MachineRow = z.infer<typeof machineRow>;

/** GET /v1/machines answers a bare array (Flutter also accepts {machines}). */
export const machinesResponse = z.union([z.array(machineRow), z.object({ machines: z.array(machineRow) }).transform((v) => v.machines)]);

export const messagesV3Response = z.object({ messages: z.array(messageRow), hasMore: z.boolean() });

export const sendMessagesV3Response = z.object({
  messages: z.array(z.object({ id: z.string(), seq: z.number().int(), localId: z.string().nullish(), createdAt: ms })),
});

export const successResponse = z.object({ success: z.boolean() });

// ---- socket.io ------------------------------------------------------------

const versioned = z.object({ value: z.string().nullish(), version: z.number().int() });

export const updateBody = z.discriminatedUnion("t", [
  z.object({ t: z.literal("new-message"), sid: z.string(), message: messageRow }),
  z.object({ t: z.literal("new-session"), id: z.string() }).loose(),
  z.object({ t: z.literal("delete-session"), sid: z.string() }),
  z.object({ t: z.literal("archive-session"), sid: z.string(), archived: z.boolean() }),
  z
    .object({
      t: z.literal("update-session"),
      id: z.string(),
      metadata: versioned.nullish(),
      agentState: versioned.nullish(),
    })
    .loose(),
  z.object({ t: z.literal("new-machine"), machineId: z.string() }).loose(),
  z
    .object({
      t: z.literal("update-machine"),
      machineId: z.string(),
      metadata: versioned.nullish(),
      daemonState: versioned.nullish(),
    })
    .loose(),
  z.object({ t: z.literal("machine-deleted"), machineId: z.string() }).loose(),
]);
export type UpdateBody = z.infer<typeof updateBody>;

export const updateEnvelope = z.object({ id: z.string(), seq: z.number().int(), body: z.unknown(), createdAt: ms });

export const ephemeral = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("activity"),
    id: z.string(),
    active: z.boolean(),
    activeAt: ms,
    thinking: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("alive-batch"),
    sessions: z.array(z.object({ id: z.string(), activeAt: ms, thinking: z.boolean().optional() })),
  }),
  z.object({ type: z.literal("machine-activity"), id: z.string(), active: z.boolean(), activeAt: ms }),
  z.object({ type: z.literal("message-stream"), id: z.string(), message: z.string() }),
]);
export type Ephemeral = z.infer<typeof ephemeral>;

export const rpcAck = z
  .object({
    ok: z.boolean().optional(),
    result: z.unknown().optional(),
    error: z.string().optional(),
    code: z.string().optional(),
  })
  .loose();
