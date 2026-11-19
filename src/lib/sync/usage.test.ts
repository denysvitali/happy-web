import { describe, expect, it } from "vitest";
import {
  contextMeter,
  contextUsageOf,
  defaultContextWindow,
  formatResetIn,
  formatTokens,
  headlineWindow,
  parseClaudeUsage,
  reportedWindowsOf,
  shortWindowLabel,
  parseCodexUsage,
  usageProvider,
} from "./usage";

const NOW = Date.parse("2026-11-18T12:00:00Z");

describe("usage limits", () => {
  it("picks the provider from the flavor", () => {
    expect(usageProvider(undefined)).toBe("claude");
    expect(usageProvider("claude")).toBe("claude");
    expect(usageProvider("codex")).toBe("codex");
    expect(usageProvider("opencode")).toBeNull();
  });

  it("parses Claude windows, model-scoped limits and extra usage", () => {
    const u = parseClaudeUsage({
      success: true,
      error: "",
      data: JSON.stringify({
        five_hour: { utilization: 42, resets_at: "2026-11-18T14:14:00Z" },
        seven_day: { utilization: 63, resets_at: null },
        seven_day_opus: { utilization: 88 },
        extra_usage: { is_enabled: true, monthly_limit: 50, used_credits: 12.5 },
        limits: [
          { group: "weekly", percent: 88, scope: { model: { display_name: "Opus" } } },
          { group: "weekly", percent: 31, resets_at: "2026-11-20T12:00:00Z", scope: { model: { display_name: "Fable" } } },
          { group: "session", percent: 10, scope: { model: { display_name: "Fable" } } },
          { group: "weekly", percent: 5, scope: {} },
        ],
      }),
    });
    expect(u?.windows.map((w) => [w.label, w.percent])).toEqual([
      ["5-Hour", 42],
      ["7-Day", 63],
      ["7-Day Opus", 88],
      ["7-Day Fable", 31],
      ["5-Hour Fable", 10],
    ]);
    expect(u?.windows[0]?.resetsAt).toBe(Date.parse("2026-11-18T14:14:00Z"));
    expect(u?.facts).toEqual(["Extra usage: $12.50 of $50.00"]);
    expect(u?.limitReached).toBe(false);
  });

  it("returns null for Claude failures and junk", () => {
    expect(parseClaudeUsage({ success: false, error: "no credentials", data: "" })).toBeNull();
    expect(parseClaudeUsage({ success: true, data: "{not json" })).toBeNull();
    expect(parseClaudeUsage({ success: true, data: "{}" })).toBeNull();
    expect(parseClaudeUsage(null)).toBeNull();
  });

  it("parses Codex rate limits, plan and credits", () => {
    const u = parseCodexUsage(
      {
        success: true,
        data: {
          plan_type: "pro",
          rate_limit: {
            allowed: true,
            limit_reached: false,
            primary_window: { used_percent: 18, limit_window_seconds: 18000, reset_after_seconds: 7200 },
            secondary_window: { used_percent: 54, limit_window_seconds: 604800, reset_at: NOW / 1000 + 3600 },
          },
          credits: { has_credits: true, unlimited: false, balance: "42.10" },
        },
      },
      NOW,
    );
    expect(u?.windows).toEqual([
      { label: "5-Hour", percent: 18, resetsAt: NOW + 7_200_000 },
      { label: "7-Day", percent: 54, resetsAt: NOW + 3_600_000 },
    ]);
    expect(u?.facts).toEqual(["Plan: Pro", "Credits: 42.10"]);
    const reached = parseCodexUsage({ success: true, data: { rate_limit: { allowed: false, primary_window: { used_percent: 100, limit_window_seconds: 3600 } } } });
    expect(reached?.limitReached).toBe(true);
    expect(reached?.windows[0]?.label).toBe("1-Hour");
    expect(parseCodexUsage({ success: false, error: "x" })).toBeNull();
  });

  it("formats reset countdowns", () => {
    expect(formatResetIn(NOW + (2 * 60 + 14) * 60_000, NOW)).toBe("resets in 2h 14m");
    expect(formatResetIn(NOW + 3 * 86_400_000 + 4 * 3_600_000, NOW)).toBe("resets in 3d 4h");
    expect(formatResetIn(NOW + 5 * 60_000, NOW)).toBe("resets in 5m");
    expect(formatResetIn(NOW - 1, NOW)).toBe("resets soon");
    expect(formatResetIn(undefined, NOW)).toBeUndefined();
  });
});

describe("context usage", () => {
  const claude = (data: object) => ({ role: "agent", content: { type: "output", data } });

  it("reads Claude assistant usage with the cache formula", () => {
    const rec = claude({
      type: "assistant",
      message: { model: "claude-opus-5", usage: { input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 59_000, output_tokens: 400 } },
    });
    expect(contextUsageOf(rec)).toEqual({ used: 62_000, window: undefined, model: "claude-opus-5" });
  });

  it("ignores sidechain rows, results and user records", () => {
    expect(contextUsageOf(claude({ type: "assistant", parent_tool_use_id: "t1", message: { usage: { input_tokens: 5 } } }))).toBeNull();
    expect(contextUsageOf(claude({ type: "result", usage: { input_tokens: 5 } }))).toBeNull();
    expect(contextUsageOf({ role: "user", content: { type: "text", text: "hi" } })).toBeNull();
    expect(contextUsageOf(claude({ type: "assistant", message: { content: [] } }))).toBeNull();
  });

  it("reads Codex and ACP usage", () => {
    expect(contextUsageOf({ role: "agent", content: { type: "codex", data: { type: "token_count", usage: { input_tokens: 30_000, cached_input_tokens: 10_000 } } } })?.used).toBe(30_000);
    expect(contextUsageOf({ role: "agent", content: { type: "codex", data: { message: { usage: { input_tokens: 7 } } } } })?.used).toBe(7);
    expect(
      contextUsageOf({ role: "agent", content: { type: "acp", data: { type: "usage", usage: { context_size: 120_000, context_window: 400_000, model: "gemini-3-pro" } } } }),
    ).toEqual({ used: 120_000, window: 400_000, model: "gemini-3-pro" });
    expect(contextUsageOf({ role: "agent", content: { type: "acp", data: { type: "message", usage: { context_size: 1 } } } })).toBeNull();
  });

  it("defaults the window by model", () => {
    expect(defaultContextWindow("opus:high[1m]")).toBe(1_000_000);
    expect(defaultContextWindow("claude-sonnet-4-5-1m")).toBe(1_000_000);
    expect(defaultContextWindow("gpt-5.5")).toBe(1_000_000);
    expect(defaultContextWindow("gpt-4.1-mini")).toBe(1_000_000);
    expect(defaultContextWindow("gemini-2.5-pro")).toBe(1_000_000);
    expect(defaultContextWindow("o3")).toBe(200_000);
    expect(defaultContextWindow("o4-mini")).toBe(200_000);
    expect(defaultContextWindow("sonnet")).toBe(190_000);
    expect(defaultContextWindow(undefined)).toBe(190_000);
  });

  it("levels: warn at ≤15% left, critical at ≤5%", () => {
    expect(contextMeter({ used: 100_000, window: 200_000 }).level).toBe("ok");
    expect(contextMeter({ used: 170_000, window: 200_000 }).level).toBe("warn");
    expect(contextMeter({ used: 190_000, window: 200_000 }).level).toBe("critical");
    expect(contextMeter({ used: 500_000, window: 200_000 }).fraction).toBe(1);
    // The selection's [1m] marker wins over a reported id without it.
    expect(contextMeter({ used: 10, model: "claude-opus-5" }, "opus[1m]").window).toBe(1_000_000);
    expect(contextMeter({ used: 10 }).window).toBe(190_000);
  });

  it("formats token counts", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(62_400)).toBe("62k");
    expect(formatTokens(200_000)).toBe("200k");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(1_250_000)).toBe("1.25M");
  });
});

describe("context window sources", () => {
  const result = (modelUsage: object, extra: object = {}) => ({ role: "agent", content: { type: "output", data: { type: "result", modelUsage, ...extra } } });

  it("reads Claude's per-model windows from result records, main thread only", () => {
    expect(reportedWindowsOf(result({ "claude-opus-5-5": { contextWindow: 1_000_000 }, "claude-haiku-5-5": { contextWindow: 200_000 } }))).toEqual({
      "claude-opus-5-5": 1_000_000,
      "claude-haiku-5-5": 200_000,
    });
    expect(reportedWindowsOf(result({ x: { contextWindow: 5 } }, { parent_tool_use_id: "t1" }))).toBeNull();
    expect(reportedWindowsOf(result({ x: {} }))).toBeNull();
  });

  it("prefers usage row, then reported, then profile, then known model, then assumed", () => {
    const reported = { "claude-opus-5-5": 1_000_000, "claude-haiku-5-5": 200_000 };
    expect(contextMeter({ used: 10, window: 50_000 }, "opus", { reported, profile: 300_000 })).toMatchObject({ window: 50_000, source: "reported" });
    expect(contextMeter({ used: 250_000, model: "claude-opus-5-5" }, undefined, { reported })).toMatchObject({ window: 1_000_000, source: "reported", level: "ok" });
    // No model on the row: the largest reported window is the main model's.
    expect(contextMeter({ used: 1 }, "opus", { reported })).toMatchObject({ window: 1_000_000 });
    expect(contextMeter({ used: 1, model: "glm-5" }, undefined, { profile: 128_000 })).toMatchObject({ window: 128_000, source: "profile" });
    expect(contextMeter({ used: 1, model: "gemini-3-pro" })).toMatchObject({ window: 1_000_000, source: "model" });
    expect(contextMeter({ used: 1, model: "claude-opus-5-5" })).toMatchObject({ window: 190_000, source: "assumed" });
  });

  it("headlines the window closest to its limit, with a short label", () => {
    const u = { provider: "claude" as const, facts: [], limitReached: false, windows: [{ label: "5-Hour", percent: 12 }, { label: "7-Day Opus", percent: 91 }] };
    expect(headlineWindow(u)?.label).toBe("7-Day Opus");
    expect(shortWindowLabel("5-Hour")).toBe("5h");
    expect(shortWindowLabel("7-Day Opus")).toBe("7d");
    expect(shortWindowLabel("Primary")).toBe("Primary");
  });
});
