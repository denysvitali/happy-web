import { describe, expect, it } from "vitest";
import type { SessionItem } from "./account";
import { inboxCatalog, InboxTriage, needsReply, parseInboxMessage, parseTriage, replyText, unreadCount, type InboxEntryState } from "./inbox";

const NOW = Date.UTC(2026, 10, 19, 12);

function session(id: string, inbox: unknown[], o: Partial<SessionItem> = {}): SessionItem {
  return { id, active: false, activeAt: NOW, archived: false, createdAt: NOW, updatedAt: NOW, lifecycle: "", meta: { summary: { text: `Session ${id}`, updatedAt: NOW }, inbox }, metadataVersion: 1, agentState: {}, agentStateVersion: 0, undecryptable: false, ...o };
}
const msg = (id: string, kind: string, createdAt: number, extra: object = {}) => ({ id, kind, subject: `Subject ${id}`, body: "", createdAt, ...extra });

describe("inbox model", () => {
  it("parses only well-formed entries of known kinds", () => {
    expect(parseInboxMessage(msg("a", "question", 1, { options: ["Yes", "", 3, "No"] }), "s1")).toMatchObject({ kind: "question", options: ["Yes", "No"] });
    expect(parseInboxMessage(msg("a", "nope", 1), "s1")).toBeNull();
    expect(parseInboxMessage({ ...msg("a", "blocked", 1), subject: "  " }, "s1")).toBeNull();
    expect(parseInboxMessage({ ...msg("a", "blocked", 1), createdAt: "x" }, "s1")).toBeNull();
    // Cloned metadata: stamped for another session.
    expect(parseInboxMessage(msg("a", "blocked", 1, { sessionId: "other" }), "s1")).toBeNull();
    expect(parseInboxMessage(msg("a", "blocked", 1, { sessionId: "s1" }), "s1")).not.toBeNull();
  });

  it("lists every session's messages newest first, deduplicated", () => {
    const items = inboxCatalog([session("s1", [msg("a", "question", 10), msg("a", "question", 10), "junk"]), session("s2", [msg("b", "goal_reached", 20)], { archived: true })]);
    expect(items.map((i) => i.key)).toEqual(["s2/b", "s1/a"]);
    expect(items[0]).toMatchObject({ sessionTitle: "Session s2", archived: true });
  });

  it("counts unread outside Done and knows what waits on the user", () => {
    const items = inboxCatalog([session("s1", [msg("q", "question", 1), msg("g", "goal_reached", 2), msg("b", "blocked", 3)])]);
    const states = new Map<string, InboxEntryState>([["s1/g", { read: true }], ["s1/b", { done: true }]]);
    expect(unreadCount(items, states)).toBe(1);
    const [b, g, q] = items;
    expect(needsReply(q!, undefined)).toBe(true);
    expect(needsReply(q!, { repliedAt: 1 })).toBe(false);
    expect(needsReply(g!, undefined)).toBe(false);
    expect(needsReply(b!, states.get("s1/b"))).toBe(false);
    expect(replyText(q!.message, "  ship it ")).toBe("Re: Subject q\n\nship it");
  });
});

describe("inbox triage", () => {
  const memory = () => {
    let saved: Record<string, InboxEntryState> = {};
    return { load: () => saved, save: (v: Record<string, InboxEntryState>) => (saved = JSON.parse(JSON.stringify(v)) as Record<string, InboxEntryState>), get: () => saved };
  };

  it("tracks read, done and replies and persists them", () => {
    const store = memory();
    const t = new InboxTriage(store);
    t.markRead("s/a");
    t.setDone("s/b", true);
    t.recordReply("s/c", "yes", 5);
    t.markUnread("s/a");
    expect(store.get()).toEqual({ "s/a": {}, "s/b": { read: true, done: true }, "s/c": { read: true, reply: "yes", repliedAt: 5 } });
    t.setDone("s/b", false);
    expect(t.states.get().get("s/b")).toEqual({ read: true });
    expect(new InboxTriage(store).states.get().get("s/c")?.reply).toBe("yes");
  });

  it("files many as done at once and undoes it exactly", () => {
    const store = memory();
    const t = new InboxTriage(store);
    t.recordReply("s/a", "ok", 1);
    const undo = t.setDone(["s/a", "s/b"], true);
    expect(store.get()).toEqual({ "s/a": { read: true, reply: "ok", repliedAt: 1, done: true }, "s/b": { read: true, done: true } });
    t.restore(undo);
    expect(store.get()).toEqual({ "s/a": { read: true, reply: "ok", repliedAt: 1 } });
  });

  it("drops malformed stored state", () => {
    expect(parseTriage({ "s/a": { read: true, done: "x", reply: 3 }, "s/b": null })).toEqual({ "s/a": { read: true } });
    expect(parseTriage("nope")).toEqual({});
  });
});
