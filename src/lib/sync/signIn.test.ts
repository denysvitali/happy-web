import { describe, expect, it } from "vitest";
import { addMessages, buildView, emptyChat, needsUser, type Block, type ChatMessage } from "./chat";
import { normalizeRecord } from "./normalize";
import { isSignInUrl, signInOf } from "./signIn";

const URL_OK = "https://claude.com/cai/oauth/authorize?code=true&client_id=x";
const login = (extra: object = {}) => ({ provider: "claude", url: URL_OK, expiresAt: 1_900_000_000_000, method: "claude-login-submit", ...extra });
const gate = (claudeLogin?: object, t = "Claude Code is not signed in for this session.\n\n1. Open this link…") => ({
  role: "agent",
  content: { type: "output", data: { type: "assistant", message: { role: "assistant", model: "happy", content: [{ type: "text", text: t }] }, ...(claudeLogin ? { claudeLogin } : {}) } },
});
const reply = (t: string) => ({ role: "agent", content: { type: "output", data: { type: "assistant", message: { content: [{ type: "text", text: t }] } } } });

describe("signInOf", () => {
  it("reads the gate's block and keeps only the lead", () => {
    expect(signInOf(gate(login()).content.data as Record<string, unknown>, "Claude rejected it.\n\n1. Open…")).toEqual({
      provider: "claude",
      url: URL_OK,
      method: "claude-login-submit",
      expiresAt: 1_900_000_000_000,
      lead: "Claude rejected it.",
    });
  });

  it("refuses links off Claude's own hosts and odd methods", () => {
    expect(isSignInUrl("https://claude.ai/oauth/authorize?x=1")).toBe(true);
    expect(isSignInUrl("http://claude.ai/oauth/authorize")).toBe(false);
    expect(isSignInUrl("https://claude.ai.evil.example/oauth")).toBe(false);
    expect(isSignInUrl("https://user@claude.ai/")).toBe(false);
    expect(isSignInUrl("javascript:alert(1)")).toBe(false);
    const data = (b: object) => gate(b).content.data as Record<string, unknown>;
    expect(signInOf(data(login({ url: "https://evil.example/oauth/authorize" })), "")).toBeUndefined();
    expect(signInOf(data(login({ method: "bash" })), "")).toBeUndefined();
    expect(signInOf(data(login({ provider: "codex" })), "")).toBeUndefined();
  });
});

describe("sign-in blocks", () => {
  let seq = 0;
  const msg = (r: unknown): ChatMessage => ({ id: `m${++seq}`, seq, createdAt: seq, norm: normalizeRecord(r) });
  const view = (...rs: unknown[]) => buildView(addMessages(emptyChat, rs.map(msg)), {}).blocks.filter((b) => b.type !== "day");
  const signIns = (bs: Block[]) => bs.filter((b): b is Extract<Block, { type: "sign-in" }> => b.type === "sign-in");

  it("replaces the gate's text with a card that waits for the user", () => {
    const bs = view(gate(login()));
    expect(bs.map((b) => b.type)).toEqual(["sign-in"]);
    expect(needsUser(bs[0]!)).toBe(true);
    expect(normalizeRecord(gate(login())).model).toBeUndefined();
  });

  it("keeps plain text when the row has no usable block", () => {
    expect(view(gate()).map((b) => b.type)).toEqual(["text"]);
  });

  it("settles once the agent speaks again or a newer request lands", () => {
    const [a, b] = signIns(view(gate(login()), gate(login())));
    expect([a!.settled, b!.settled]).toEqual([true, undefined]);
    const [c] = signIns(view(gate(login()), reply("Signed in to Claude Code.")));
    expect(c!.settled).toBe(true);
    expect(needsUser(c!)).toBe(false);
  });
});
